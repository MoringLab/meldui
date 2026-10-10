import 'dart:async';
import 'dart:convert';
import 'package:a2ui_core/a2ui_core.dart' as a2ui;
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'expression.dart';

const catalogId = 'urn:engine:catalog:core:1';
typedef JsonMap = Map<String, dynamic>;

class KitTypography {
  final double bodySize, bodyLineHeight, smallSize, smallLineHeight;
  final int bodyWeight, headingWeight;
  final String? bodyFamily, headingFamily;
  final List<double> headingSizes, headingLineHeights;
  const KitTypography({
    required this.bodySize,
    required this.bodyWeight,
    required this.bodyLineHeight,
    required this.bodyFamily,
    required this.smallSize,
    required this.smallLineHeight,
    required this.headingWeight,
    required this.headingSizes,
    required this.headingLineHeights,
    required this.headingFamily,
  });
}

/// Portable kit manifest. Renderer implementations are registered by the host.
class UIKit {
  final JsonMap manifest;
  UIKit(this.manifest) {
    if (manifest['catalogId'] is! String ||
        (manifest['catalogId'] as String).isEmpty ||
        manifest['tokens'] is! Map) {
      throw StateError('INVALID_KIT');
    }
  }
  String get id => manifest['id'] as String;
  JsonMap colors(bool dark) => Map<String, dynamic>.from(
    manifest['tokens'][dark ? 'dark' : 'light'] as Map,
  );
  double get radius => (manifest['tokens']['radius'] as num).toDouble();
  int get motionMs => (manifest['tokens']['motionMs'] as num? ?? 140).toInt();

  /// Concrete typography; mirrors `resolveTypography` in @engine/kit-spec (shared via parity tests).
  KitTypography typography({bool ios = false}) {
    final t = Map<String, dynamic>.from(manifest['tokens']['typography'] as Map);
    final base = (t['baseSize'] as num).toDouble();
    final lineHeight = (t['lineHeight'] as num? ?? 1.55).toDouble();
    final headingLine = (t['headingLineHeight'] as num? ?? 1.2).toDouble();
    final scale = ((t['scale'] as List?) ?? const [2.25, 1.75, 1.375, 1.125, 1, 0.875])
        .map((e) => (e as num).toDouble())
        .toList();
    final native = Map<String, dynamic>.from((t['native'] as Map?) ?? const {});
    String? pick(dynamic family) => family is String
        ? family
        : family is Map
        ? (family[ios ? 'ios' : 'android'] as String?)
        : null;
    final sizes = [for (final m in scale) (base * m).roundToDouble()];
    final small = (base * 0.875).roundToDouble().clamp(12.0, double.infinity);
    return KitTypography(
      bodySize: base,
      bodyWeight: (t['bodyWeight'] as num? ?? 400).toInt(),
      bodyLineHeight: (base * lineHeight).roundToDouble(),
      bodyFamily: pick(native['body']),
      smallSize: small,
      smallLineHeight: (small * lineHeight).roundToDouble(),
      headingWeight: (t['headingWeight'] as num? ?? 600).toInt(),
      headingSizes: sizes,
      headingLineHeights: [for (final s in sizes) (s * headingLine).roundToDouble()],
      headingFamily: pick(native['heading']),
    );
  }
  static Future<UIKit> load(String id) async => UIKit(
    jsonDecode(
          await rootBundle.loadString(
            'packages/engine_flutter/assets/kit-$id.json',
          ),
        )
        as JsonMap,
  );
}

class _Function extends a2ui.FunctionImplementation {
  _Function(a2ui.FunctionApi api)
    : super(
        name: api.name,
        argumentSchema: api.argumentSchema,
        returnType: api.returnType,
      );
  @override
  Object? execute(
    Map<String, dynamic> args,
    a2ui.DataContext context, [
    a2ui.CancellationSignal? cancellationSignal,
  ]) {
    if (!name.startsWith('compute')) {
      throw StateError('ACTION_DISPATCH_REQUIRED');
    }
    return evaluateExpression(
      args['expr'],
      (path) => context.dataModel.get(resolvePath(path, context.path)),
    );
  }
}

/// A policy boundary around upstream A2UI message processing and reactive state.
class UIRuntime extends ChangeNotifier {
  final a2ui.MessageProcessor<a2ui.ComponentApi> processor;
  final String catalogIdentifier;
  final void Function(JsonMap)? onAction;
  final Map<String, FutureOr<void> Function(JsonMap)> clientActions;
  final List<JsonMap> diagnostics = [];
  final Map<String, Set<String>> _dirty = {};
  final Map<String, Map<String, JsonMap>> _pending = {};
  final Map<String, Set<VoidCallback>> _nodeListeners = {};
  final Map<String, String> _errors = {};
  final Set<String> _seen = {};
  bool _disposed = false;
  int _generation = 0;
  int _diagnosticSequence = 0;
  final List<(int, JsonMap)> _diagnosticEvents = [];
  final Set<VoidCallback> _cleanups = {};
  UIRuntime._(
    this.processor,
    this.catalogIdentifier, {
    this.onAction,
    this.clientActions = const {},
  });

  static Future<a2ui.Catalog<a2ui.ComponentApi, a2ui.FunctionImplementation>>?
  _defaultCatalog;
  static Future<a2ui.Catalog<a2ui.ComponentApi, a2ui.FunctionImplementation>>
  _loadCatalog([JsonMap? schema]) async {
    final document =
        schema ??
        jsonDecode(
              await rootBundle.loadString(
                'packages/engine_flutter/assets/catalog.json',
              ),
            )
            as JsonMap;
    final loaded = a2ui.Catalog.fromJson(document);
    return a2ui.Catalog<a2ui.ComponentApi, a2ui.FunctionImplementation>(
      id: loaded.id,
      components: loaded.components.values.toList(),
      functions: loaded.functions.values.map(_Function.new).toList(),
    );
  }

  static Future<UIRuntime> create({
    void Function(JsonMap)? onAction,
    Map<String, FutureOr<void> Function(JsonMap)> clientActions = const {},
    JsonMap? schema,
  }) async {
    // Cache immutable catalog descriptors, never surfaces or conversation data.
    final catalog = await (schema == null
        ? (_defaultCatalog ??= _loadCatalog())
        : _loadCatalog(schema));
    final processor = a2ui.MessageProcessor<a2ui.ComponentApi>(
      catalogs: [catalog],
      protocolVersion: a2ui.A2uiProtocolVersion.v0_9,
      validationConfig: a2ui.ValidationConfig.relaxed,
    );
    return UIRuntime._(
      processor,
      catalog.id,
      onAction: onAction,
      clientActions: clientActions,
    );
  }

  List<String> get surfaceIds =>
      processor.groupModel.allSurfaces.map((surface) => surface.id).toList();
  a2ui.SurfaceModel<a2ui.ComponentApi>? surface(String id) =>
      processor.groupModel.getSurface(id);
  void report(
    String code, {
    String? surfaceId,
    String? componentId,
    String? path,
  }) {
    if (diagnostics.length >= 200) diagnostics.removeAt(0);
    final diagnostic = <String, dynamic>{
      'code': code,
      'surfaceId': surfaceId,
      'componentId': componentId,
      'path': path,
    };
    diagnostics.add(diagnostic);
    _diagnosticEvents.add((++_diagnosticSequence, diagnostic));
    if (_diagnosticEvents.length > 200) _diagnosticEvents.removeAt(0);
    if (!_disposed) notifyListeners();
  }

  void _notifyNode(String sid, String id) {
    for (final fn in List<VoidCallback>.of(
      _nodeListeners['$sid\x00$id'] ?? {},
    )) {
      fn();
    }
  }

  List<JsonMap> accept(dynamic input, {String? eventId}) {
    if (_disposed) throw StateError('RUNTIME_DISPOSED');
    if (eventId != null && _seen.contains(eventId)) return [];
    final before = _diagnosticSequence;
    String? sid;
    try {
      assertSafeJson(input);
      if (utf8.encode(jsonEncode(input)).length > 256 * 1024) {
        throw StateError('MESSAGE_LIMIT');
      }
      final message = Map<String, dynamic>.from(input as Map);
      if (message['version'] != 'v0.9') throw StateError('UNSUPPORTED_VERSION');
      final keys = message.keys.where((key) => key != 'version').toList();
      if (keys.length != 1 ||
          ![
            'createSurface',
            'updateComponents',
            'updateDataModel',
            'deleteSurface',
          ].contains(keys.first)) {
        throw StateError('INVALID_ENVELOPE');
      }
      final kind = keys.first;
      final body = Map<String, dynamic>.from(message[kind] as Map);
      sid = body['surfaceId'] as String;
      if (sid.isEmpty || sid.length > 128) {
        throw StateError('INVALID_SURFACE_ID');
      }
      if (kind != 'createSurface' && surface(sid) == null) {
        throw StateError('UNKNOWN_SURFACE');
      }
      if (kind == 'createSurface') {
        if (surface(sid) != null) throw StateError('DUPLICATE_SURFACE');
        if (surfaceIds.length >= 16) throw StateError('SURFACE_LIMIT');
        if (body['catalogId'] != catalogIdentifier ||
            body['sendDataModel'] == true) {
          throw StateError('INVALID_CATALOG');
        }
        _process(message);
        notifyListeners();
      } else if (kind == 'updateComponents') {
        final components = body['components'] as List;
        final ids = components.map((c) => c['id']).toSet();
        if (components.isEmpty || ids.length != components.length) {
          throw StateError('DUPLICATE_COMPONENT_ID');
        }
        final existing = surface(sid)!.componentsModel;
        final tracked = existing.all.map((c) => c.id).toSet();
        for (final key in _errors.keys) {
          if (key.startsWith('$sid\x00')) {
            tracked.add(key.substring(sid.length + 1));
          }
        }
        final newCount = ids.where((id) => !tracked.contains(id)).length;
        if (tracked.length + newCount > 2000) {
          throw StateError('COMPONENT_LIMIT');
        }
        // Upstream validates the entire batch before mutation. The normal path
        // therefore checks its graph once; only rejected batches need isolation.
        var applied = false;
        try {
          _process(message);
          applied = true;
        } catch (_) {}
        for (final raw in components) {
          final component = Map<String, dynamic>.from(raw as Map);
          final id = component['id'] as String;
          try {
            if (!applied) {
              _process({
                'version': 'v0.9',
                'updateComponents': {
                  'surfaceId': sid,
                  'components': [component],
                },
              });
            }
            _errors.remove('$sid\x00$id');
          } catch (_) {
            _errors['$sid\x00$id'] = 'INVALID_COMPONENT';
            report('INVALID_COMPONENT', surfaceId: sid, componentId: id);
          }
          _notifyNode(sid, id);
        }
      } else if (kind == 'updateDataModel') {
        final path = resolvePath(body['path'] as String? ?? '/');
        if ((_dirty[sid] ?? {}).any((edited) => _overlaps(edited, path))) {
          final writes = _pending.putIfAbsent(sid, () => {});
          if (writes.length >= 200 && !writes.containsKey(path)) {
            writes.remove(writes.keys.first);
          }
          writes[path] = message;
          report('LOCAL_EDIT_CONFLICT', surfaceId: sid, path: path);
        } else if (body.containsKey('value') && body['value'] == null) {
          _setData(sid, path, null);
        } else {
          _process(message);
        }
      } else {
        _process(message);
        _dirty.remove(sid);
        _pending.remove(sid);
        _errors.removeWhere((key, _) => key.startsWith('$sid\x00'));
        notifyListeners();
      }
      if (eventId != null) {
        if (_seen.length >= 10000) _seen.remove(_seen.first);
        _seen.add(eventId);
      }
    } catch (error) {
      report(
        error is StateError ? error.message.toString() : 'INVALID_MESSAGE',
        surfaceId: sid,
      );
    }
    return _diagnosticEvents
        .where((entry) => entry.$1 > before)
        .map((entry) => entry.$2)
        .toList();
  }

  void _process(JsonMap message) => processor.processMessages(
    a2ui.AgentToRendererMessagePayload.fromJson(
      message,
      protocolVersion: a2ui.A2uiProtocolVersion.v0_9,
    ),
  );
  dynamic read(String sid, String path, [String scope = '/']) =>
      surface(sid)?.dataModel.get(resolvePath(path, scope));
  dynamic resolve(String sid, dynamic value, [String scope = '/']) {
    if (value is List) return value.map((v) => resolve(sid, v, scope)).toList();
    if (value is! Map) return value;
    if (value['path'] is String && value.length == 1) {
      return read(sid, value['path'] as String, scope);
    }
    if (value['call'] is String) {
      if (![
        'computeNumber',
        'computeString',
        'computeBoolean',
        'computeArray',
      ].contains(value['call'])) {
        throw StateError('IMPURE_EXPRESSION');
      }
      final result = evaluateExpression(
        value['args']['expr'],
        (path) => read(sid, path, scope),
      );
      final expected = value['call'];
      if ((expected == 'computeNumber' && result is! num) ||
          (expected == 'computeString' && result is! String) ||
          (expected == 'computeBoolean' && result is! bool) ||
          (expected == 'computeArray' && result is! List)) {
        throw StateError('EXPRESSION_TYPE');
      }
      return result;
    }
    return {
      for (final entry in value.entries)
        entry.key: resolve(sid, entry.value, scope),
    };
  }

  JsonMap node(String sid, String id, [String scope = '/']) {
    final model = surface(sid)?.componentsModel.get(id);
    if (model == null) {
      return {
        'id': id,
        'error': _errors['$sid\x00$id'],
        'props': <String, dynamic>{},
      };
    }
    try {
      return {
        'id': id,
        'component': model.type,
        'raw': model.toJson(),
        'props': {
          for (final entry in model.properties.entries)
            entry.key:
                [
                  'action',
                  'onSubmit',
                  'children',
                  'tabs',
                  'items',
                ].contains(entry.key)
                ? entry.value
                : resolve(sid, entry.value, scope),
        },
      };
    } catch (error) {
      return {
        'id': id,
        'error': error is StateError ? error.message : 'EXPRESSION_ERROR',
        'props': <String, dynamic>{},
      };
    }
  }

  List<JsonMap> getPendingWrites(String sid) => [
    for (final entry in (_pending[sid] ?? {}).entries)
      {'path': entry.key, 'message': entry.value},
  ];
  List<JsonMap> resolveConflict(String sid, String path, String decision) {
    final resolved = resolvePath(path);
    final message = _pending[sid]?.remove(resolved);
    if (message == null) throw StateError('UNKNOWN_CONFLICT');
    if (decision == 'accept-model') {
      _dirty[sid]?.removeWhere((edit) => _overlaps(edit, resolved));
      return accept(message);
    }
    if (decision != 'keep-local') throw StateError('INVALID_DECISION');
    return [];
  }

  /// Notify only consumers of this node and its referenced data paths.
  VoidCallback subscribeNode(
    String sid,
    String id,
    String scope,
    VoidCallback listener,
  ) {
    final key = '$sid\x00$id';
    final listeners = _nodeListeners.putIfAbsent(key, () => {});
    VoidCallback? stopEffect;
    void bind() {
      stopEffect?.call();
      final model = surface(sid)?.componentsModel.get(id);
      final paths = <String>{};
      void walk(dynamic value) {
        if (value is Map) {
          for (final entry in value.entries) {
            if ((entry.key == 'path' || entry.key == 'ref') &&
                entry.value is String) {
              paths.add(resolvePath(entry.value as String, scope));
            } else {
              walk(entry.value);
            }
          }
        } else if (value is List) {
          for (final child in value) {
            walk(child);
          }
        }
      }

      walk(model?.properties);
      if (surface(sid) != null && paths.isNotEmpty) {
        stopEffect = a2ui.effect(() {
          for (final path in paths) {
            surface(sid)!.dataModel.watch<Object?>(path).value;
          }
          listener();
        });
      } else {
        listener();
      }
    }

    listeners.add(bind);
    bind();
    late VoidCallback cleanup;
    cleanup = () {
      stopEffect?.call();
      listeners.remove(bind);
      if (listeners.isEmpty) _nodeListeners.remove(key);
      _cleanups.remove(cleanup);
    };
    _cleanups.add(cleanup);
    return cleanup;
  }

  void setValue(String sid, String path, dynamic value, [String scope = '/']) {
    assertSafeJson(value);
    final resolved = resolvePath(path, scope);
    final target = surface(sid);
    if (target == null) throw StateError('UNKNOWN_SURFACE');
    _setData(sid, resolved, value);
    _dirty.putIfAbsent(sid, () => {}).add(resolved);
  }

  // Upstream Dart treats null as removal. Parent replacement preserves explicit
  // JSON null while omitted wire values retain upstream deletion semantics.
  void _setData(String sid, String path, dynamic value) {
    final model = surface(sid)!.dataModel;
    if (value != null || path == '/') {
      model.set(path, value);
      return;
    }
    final split = path.lastIndexOf('/');
    final parentPath = split == 0 ? '/' : path.substring(0, split);
    final key = path
        .substring(split + 1)
        .replaceAll('~1', '/')
        .replaceAll('~0', '~');
    final existing = model.get(parentPath);
    dynamic parent;
    if (existing is List) {
      final index = int.tryParse(key);
      if (index == null || index < 0 || index > 10000) {
        throw StateError('INVALID_POINTER');
      }
      parent = List<dynamic>.from(existing);
      while (parent.length <= index) {
        parent.add(null);
      }
      parent[index] = null;
    } else if (existing == null || existing is Map) {
      parent = existing == null
          ? <String, dynamic>{}
          : Map<String, dynamic>.from(existing as Map);
      parent[key] = null;
    } else {
      throw StateError('INVALID_POINTER');
    }
    model.set(parentPath, parent);
  }

  int beginRun(String sid) => ++_generation;
  void cancel() {
    ++_generation;
  }

  Future<void> consume(Stream<List<int>> stream) async {
    final run = ++_generation;
    var bytes = 0;
    var buffer = '';
    try {
      await for (final chunk in stream.transform(utf8.decoder)) {
        if (_disposed || run != _generation) break;
        bytes += utf8.encode(chunk).length;
        if (bytes > 8 * 1024 * 1024) {
          report('STREAM_LIMIT');
          break;
        }
        buffer += chunk;
        while (buffer.contains('\n')) {
          final index = buffer.indexOf('\n');
          _line(buffer.substring(0, index));
          buffer = buffer.substring(index + 1);
        }
        if (utf8.encode(buffer).length > 256 * 1024) {
          report('MESSAGE_LIMIT');
          return;
        }
      }
    } on FormatException {
      if (!_disposed && run == _generation) report('INVALID_UTF8');
      return;
    }
    if (!_disposed && run == _generation) {
      _line(buffer);
      finish();
    }
  }

  void _line(String line) {
    if (line.trim().isEmpty) return;
    try {
      accept(jsonDecode(line));
    } catch (_) {
      report('INVALID_JSON');
    }
  }

  void finish() {
    for (final sid in surfaceIds) {
      final model = surface(sid)!.componentsModel;
      if (model.get('root') == null) {
        report('MISSING_ROOT', surfaceId: sid);
        continue;
      }
      final seen = <String>{};
      void walk(String id, int depth) {
        if (depth > 50) {
          report('GRAPH_LIMIT', surfaceId: sid);
          return;
        }
        if (!seen.add(id)) return;
        final component = model.get(id);
        if (component == null) {
          report('MISSING_COMPONENT', surfaceId: sid, componentId: id);
          return;
        }
        final props = component.properties;
        final children = props['children'];
        if (children is List) {
          for (final child in children) {
            walk(child as String, depth + 1);
          }
        } else if (children is Map) {
          walk(children['componentId'] as String, depth + 1);
        }
        for (final item in (props['tabs'] ?? props['items'] ?? []) as List) {
          walk(item['child'] as String, depth + 1);
        }
      }

      walk('root', 0);
    }
  }

  Future<void> dispatch(
    String sid,
    String id,
    JsonMap action, [
    String scope = '/',
  ]) async {
    try {
      if (surface(sid)?.componentsModel.get(id) == null) {
        throw StateError('UNKNOWN_COMPONENT');
      }
      assertSafeJson(action);
      if (action['event'] is Map) {
        final event = action['event'] as Map;
        onAction?.call({
          'name': event['name'],
          'timestamp': DateTime.now().toUtc().toIso8601String(),
          'surfaceId': sid,
          'sourceComponentId': id,
          'context': resolve(sid, event['context'] ?? {}, scope),
        });
        return;
      }
      final call = action['functionCall'] as Map;
      final args = Map<String, dynamic>.from(call['args'] as Map);
      if (call['call'] == 'setValue' || call['call'] == 'setValues') {
        final updates = call['call'] == 'setValue'
            ? [args]
            : args['updates'] as List;
        if (updates.length > 20) throw StateError('ACTION_LIMIT');
        final resolved = updates
            .map(
              (entry) => {
                'path': resolvePath(entry['path'] as String, scope),
                'value': entry.containsKey('expr')
                    ? evaluateExpression(
                        entry['expr'],
                        (path) => read(sid, path, scope),
                      )
                    : resolve(sid, entry['value'], scope),
              },
            )
            .toList();
        final check = a2ui.DataModel(jsonDecode(jsonEncode(read(sid, '/'))));
        try {
          for (final entry in resolved) {
            assertSafeJson(entry['value']);
            check.set(entry['path'] as String, entry['value']);
          }
        } finally {
          check.dispose();
        }
        for (final entry in resolved) {
          setValue(sid, entry['path'] as String, entry['value']);
        }
      } else {
        final handler = clientActions[call['call']];
        if (handler == null) throw StateError('CLIENT_ACTION_DENIED');
        final values = Map<String, dynamic>.from(
          resolve(sid, args, scope) as Map,
        );
        if (call['call'] == 'openUrl') {
          final url = Uri.parse(values['url'] as String);
          if (url.scheme != 'https' || url.userInfo.isNotEmpty) {
            throw StateError('UNSAFE_URL');
          }
        }
        await handler(values);
      }
    } catch (error) {
      report(
        error is StateError ? error.message.toString() : 'INVALID_ACTION',
        surfaceId: sid,
        componentId: id,
      );
    }
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    cancel();
    for (final cleanup in _cleanups.toList()) {
      cleanup();
    }
    processor.groupModel.dispose();
    _nodeListeners.clear();
    super.dispose();
  }
}

bool _overlaps(String a, String b) =>
    a == '/' ||
    b == '/' ||
    a == b ||
    a.startsWith('$b/') ||
    b.startsWith('$a/');
