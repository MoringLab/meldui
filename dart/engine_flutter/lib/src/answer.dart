import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'runtime.dart';
import 'expression.dart' show assertSafeJson;

/// One decoded piece of a hybrid stream: Markdown text, a one-line JSON control object, or a
/// control-looking line that failed to parse.
class AnswerItem {
  final String kind; // 'text' | 'json' | 'invalid'
  final String text;
  final JsonMap? value;
  const AnswerItem.text(this.text) : kind = 'text', value = null;
  const AnswerItem.json(JsonMap this.value) : kind = 'json', text = '';
  const AnswerItem.invalid(this.text) : kind = 'invalid', value = null;
}

/// Port of the TypeScript `AnswerDecoder`; `fixtures/hybrid/vectors.json` pins both together.
class AnswerDecoder {
  final int maxLineBytes;
  AnswerDecoder({this.maxLineBytes = 256 * 1024});
  String _buffer = '';
  String _mode = 'unknown';
  bool _fence = false;
  String _lineText = '';

  List<AnswerItem> push(String chunk) {
    _buffer += chunk;
    return _drain(false);
  }

  List<AnswerItem> finish() => _drain(true);

  void _emitText(List<AnswerItem> out, String text) {
    if (text.isEmpty) return;
    if (out.isNotEmpty && out.last.kind == 'text') {
      out[out.length - 1] = AnswerItem.text(out.last.text + text);
    } else {
      out.add(AnswerItem.text(text));
    }
  }

  void _endLine(String line) {
    if (RegExp(r'^\s{0,3}(```|~~~)').hasMatch(line)) _fence = !_fence;
    _lineText = '';
  }

  List<AnswerItem> _drain(bool isFinal) {
    final out = <AnswerItem>[];
    while (_buffer.isNotEmpty) {
      if (_mode == 'unknown') {
        final first = _buffer.indexOf(RegExp(r'\S'));
        final newline = _buffer.indexOf('\n');
        if (first == -1 || (newline != -1 && newline < first)) {
          if (newline == -1 && !isFinal) break;
          final end = newline == -1 ? _buffer.length : newline + 1;
          _emitText(out, _buffer.substring(0, end));
          _buffer = _buffer.substring(end);
          _lineText = '';
          continue;
        }
        _mode = _buffer[first] == '{' && !_fence ? 'json' : 'text';
      }
      final newline = _buffer.indexOf('\n');
      if (_mode == 'text') {
        final end = newline == -1 ? _buffer.length : newline + 1;
        final piece = _buffer.substring(0, end);
        _emitText(out, piece);
        _lineText += piece.endsWith('\n')
            ? piece.substring(0, piece.length - 1)
            : piece;
        _buffer = _buffer.substring(end);
        if (newline != -1) {
          _endLine(_lineText);
          _mode = 'unknown';
        }
        continue;
      }
      if (newline == -1 && !isFinal) {
        if (utf8.encode(_buffer).length > maxLineBytes) {
          out.add(
            AnswerItem.invalid(
              _buffer.substring(0, 80.clamp(0, _buffer.length)),
            ),
          );
          _buffer = '';
          _mode = 'unknown';
        }
        break;
      }
      final end = newline == -1 ? _buffer.length : newline;
      final line = _buffer.substring(0, end);
      _buffer = _buffer.substring(end + (newline == -1 ? 0 : 1));
      _mode = 'unknown';
      _lineText = '';
      _classify(line, newline != -1, out);
    }
    return out;
  }

  void _classify(String line, bool hadNewline, List<AnswerItem> out) {
    final raw = hadNewline ? '$line\n' : line;
    try {
      final value = jsonDecode(line);
      if (value is Map &&
          (value.containsKey('version') || value.containsKey('engine'))) {
        out.add(AnswerItem.json(Map<String, dynamic>.from(value)));
        return;
      }
    } catch (_) {
      if (RegExp(r'^\s*\{\s*"(version|engine)"').hasMatch(line)) {
        final fixed = repairJsonSyntax(line);
        try {
          final value = jsonDecode(fixed);
          if (value is Map && (value.containsKey('version') || value.containsKey('engine'))) {
            out.add(AnswerItem.json(Map<String, dynamic>.from(value)));
            return;
          }
        } catch (_) {}
        final repaired = closeTruncated(fixed);
        if (repaired != null) {
          out.add(AnswerItem.json(repaired));
          return;
        }
        out.add(
          AnswerItem.invalid(line.length > 120 ? line.substring(0, 120) : line),
        );
        final salvaged = salvageComponents(fixed);
        if (salvaged != null) {
          out.add(AnswerItem.json(salvaged));
          return;
        }
        // Rather than a silent gap, say what the block was going to show when that survives.
        final fallback = RegExp(
          r'"fallbackText"\s*:\s*"((?:[^"\\]|\\.)*)"',
        ).firstMatch(line)?.group(1);
        if (fallback != null) {
          try {
            _emitText(out, '${jsonDecode('"$fallback"')}\n');
          } catch (_) {}
        }
        return;
      }
    }
    _emitText(out, raw);
    _endLine(line);
  }
}

/// The components of an updateComponents line that cannot be parsed as a whole: every
/// `{"id":…,"component":…}` object that parses on its own is kept (mirrors @engine/core).
Map<String, dynamic>? salvageComponents(String line) {
  if (!line.contains('"updateComponents"')) return null;
  final surfaceId = RegExp(r'"surfaceId"\s*:\s*"([^"\\]{1,128})"').firstMatch(line)?.group(1);
  final version = RegExp(r'"version"\s*:\s*"(v[0-9.]{1,8})"').firstMatch(line)?.group(1) ?? 'v0.9';
  final start = line.indexOf('"components"');
  if (surfaceId == null || start < 0) return null;
  final components = <Map<String, dynamic>>[];
  final opener = RegExp(r'\{\s*"id"\s*:');
  var from = start;
  while (true) {
    final match = opener.firstMatch(line.substring(from));
    if (match == null) break;
    final at = from + match.start;
    final end = _closingBrace(line, at);
    if (end < 0 && RegExp(r'\{\s*"id"\s*:').hasMatch(line.substring(at + 1))) {
      from = at + 1; // broken, others follow
      continue;
    }
    if (end < 0) {
      final value = _closeOpen(line.substring(at).replaceAll(RegExp(r'[\]}\s]+$'), ''));
      if (value != null && value['id'] is String && value['component'] is String) {
        components.add(value);
      }
      break;
    }
    try {
      final value = jsonDecode(repairJsonSyntax(line.substring(at, end + 1)));
      if (value is Map && value['id'] is String && value['component'] is String) {
        components.add(Map<String, dynamic>.from(value));
        from = end + 1;
        continue;
      }
    } catch (_) {}
    from = at + 1;
  }
  if (components.isEmpty) return null;
  return {
    'version': version,
    'updateComponents': {'surfaceId': surfaceId, 'components': components},
  };
}

Map<String, dynamic>? _closeOpen(String text) {
  final stack = <String>[];
  var inString = false;
  for (var i = 0; i < text.length; i++) {
    final c = text[i];
    if (inString) {
      if (c == '\\') {
        i++;
      } else if (c == '"') {
        inString = false;
      }
    } else if (c == '"') {
      inString = true;
    } else if (c == '{') {
      stack.add('}');
    } else if (c == '[') {
      stack.add(']');
    } else if (c == '}' || c == ']') {
      if (stack.isEmpty || stack.removeLast() != c) return null;
    }
  }
  if (inString || stack.isEmpty) return null;
  try {
    final value = jsonDecode(repairJsonSyntax(text + stack.reversed.join()));
    return value is Map ? Map<String, dynamic>.from(value) : null;
  } catch (_) {
    return null;
  }
}

int _closingBrace(String text, int from) {
  final stack = <String>[];
  var inString = false;
  for (var i = from; i < text.length; i++) {
    final c = text[i];
    if (inString) {
      if (c == '\\') {
        i++;
      } else if (c == '"') {
        inString = false;
      }
    } else if (c == '"') {
      inString = true;
    } else if (c == '{') {
      stack.add('}');
    } else if (c == '[') {
      stack.add(']');
    } else if (c == '}' || c == ']') {
      if (stack.isEmpty || stack.removeLast() != c) return -1;
      if (stack.isEmpty) return i;
    }
  }
  return -1;
}

/// JSON slips inside long lines: a key missing its opening quote, an unquoted key, a trailing
/// comma. Only text outside strings changes (mirrors repairJsonSyntax in @engine/core).
String repairJsonSyntax(String line) {
  final out = StringBuffer();
  var inString = false;
  var expectKey = false;
  final identStart = RegExp(r'[A-Za-z_$]');
  final ident = RegExp(r'^[A-Za-z_$][\w$-]*');
  for (var i = 0; i < line.length; i++) {
    final c = line[i];
    if (inString) {
      out.write(c);
      if (c == '\\') {
        if (i + 1 < line.length) out.write(line[i + 1]);
        i++;
      } else if (c == '"') {
        inString = false;
      }
      continue;
    }
    if (c == '"') {
      inString = true;
      expectKey = false;
      out.write(c);
      continue;
    }
    if (c == '{' || c == ',') {
      if (c == ',') {
        final rest = line.substring(i + 1).trimLeft();
        if (rest.startsWith('}') || rest.startsWith(']')) continue;
      }
      final written = out.toString();
      expectKey = c == '{' || _objectContext(written);
      out.write(c);
      continue;
    }
    if (expectKey && identStart.hasMatch(c)) {
      final name = ident.firstMatch(line.substring(i))?.group(0) ?? c;
      final after = line.substring(i + name.length);
      final stray = RegExp(r'^"\s*:').hasMatch(after);
      if (stray || RegExp(r'^\s*:').hasMatch(after)) {
        out.write('"$name"');
        i += name.length - 1 + (stray ? 1 : 0);
        expectKey = false;
        continue;
      }
    }
    if (!RegExp(r'\s').hasMatch(c)) expectKey = false;
    out.write(c);
  }
  return out.toString();
}

bool _objectContext(String prefix) {
  final stack = <String>[];
  var inString = false;
  for (var i = 0; i < prefix.length; i++) {
    final c = prefix[i];
    if (inString) {
      if (c == '\\') {
        i++;
      } else if (c == '"') {
        inString = false;
      }
    } else if (c == '"') {
      inString = true;
    } else if (c == '{' || c == '[') {
      stack.add(c);
    } else if ((c == '}' || c == ']') && stack.isNotEmpty) {
      stack.removeLast();
    }
  }
  return stack.isNotEmpty && stack.last == '{';
}

/// A control line cut short after its last complete value: closes the objects and arrays it
/// left open, outside strings (mirrors closeTruncated in @engine/core).
Map<String, dynamic>? closeTruncated(String line) {
  final stack = <String>[];
  var inString = false;
  for (var i = 0; i < line.length; i++) {
    final c = line[i];
    if (inString) {
      if (c == '\\') {
        i++;
      } else if (c == '"') {
        inString = false;
      }
    } else if (c == '"') {
      inString = true;
    } else if (c == '{') {
      stack.add('}');
    } else if (c == '[') {
      stack.add(']');
    } else if (c == '}' || c == ']') {
      if (stack.isEmpty || stack.removeLast() != c) return null;
    }
  }
  if (inString || stack.isEmpty || stack.length > 4) return null;
  if (!RegExp(r'["\d\]}el]\s*$').hasMatch(line)) return null;
  try {
    final value = jsonDecode(line.trimRight() + stack.reversed.join());
    if (value is Map && (value.containsKey('version') || value.containsKey('engine'))) {
      return Map<String, dynamic>.from(value);
    }
  } catch (_) {}
  return null;
}

/// Host policy for one answer. Defaults mirror the protocol package.
class HostPolicy {
  final String mode; // auto | markdown-only | engine-only
  final int maxSurfaces;
  final List<String>? allowedComponents;
  final bool allowMedia;
  final bool allowSandbox;
  final double? maxSurfaceHeight;
  final int? maxOutputTokens;
  final int? latencyBudgetMs;
  const HostPolicy({
    this.mode = 'auto',
    this.maxSurfaces = 3,
    this.allowedComponents,
    this.allowMedia = true,
    this.allowSandbox = false,
    this.maxSurfaceHeight,
    this.maxOutputTokens,
    this.latencyBudgetMs,
  });
  factory HostPolicy.fromJson(JsonMap json) => HostPolicy(
    mode: json['mode'] as String? ?? 'auto',
    maxSurfaces: json['maxSurfaces'] as int? ?? 3,
    allowedComponents: (json['allowedComponents'] as List?)?.cast<String>(),
    allowMedia: json['allowMedia'] as bool? ?? true,
    allowSandbox: json['allowSandbox'] as bool? ?? false,
    maxSurfaceHeight: (json['maxSurfaceHeight'] as num?)?.toDouble(),
    maxOutputTokens: json['maxOutputTokens'] as int?,
    latencyBudgetMs: json['latencyBudgetMs'] as int?,
  );
}

sealed class AnswerBlock {
  final String id;
  const AnswerBlock(this.id);
  String get kind;
}

class MarkdownBlock extends AnswerBlock {
  final String text;
  final bool streaming;
  const MarkdownBlock(super.id, this.text, {this.streaming = true});
  @override
  String get kind => 'markdown';
  MarkdownBlock copy({String? text, bool? streaming}) => MarkdownBlock(
    id,
    text ?? this.text,
    streaming: streaming ?? this.streaming,
  );
}

class SurfaceBlock extends AnswerBlock {
  final String surfaceId;
  final String fallbackText;
  final String fallbackSource; // model | generated
  final String? title;
  final String status; // streaming | complete | error
  const SurfaceBlock(
    super.id,
    this.surfaceId,
    this.fallbackText,
    this.fallbackSource,
    this.title,
    this.status,
  );
  @override
  String get kind => 'surface';
  SurfaceBlock copy({String? fallbackText, String? status}) => SurfaceBlock(
    id,
    surfaceId,
    fallbackText ?? this.fallbackText,
    fallbackSource,
    title,
    status ?? this.status,
  );
}

class MediaBlock extends AnswerBlock {
  final List<String> attachmentIds;
  final String layout;
  final String? caption;
  final String? markdown;
  final String placement;
  final double mediaFraction;
  const MediaBlock(
    super.id,
    this.attachmentIds,
    this.layout,
    this.caption, {
    this.markdown,
    this.placement = "below",
    this.mediaFraction = 0.4,
  });
  @override
  String get kind => 'media';
}

class SandboxBlock extends AnswerBlock {
  final String mode;
  final String fallbackText;
  const SandboxBlock(super.id, this.mode, this.fallbackText);
  @override
  String get kind => 'sandbox';
}

/// Ordered Markdown, surface and media blocks around one [UIRuntime]. Notifies on every change.
class AnswerSession extends ChangeNotifier {
  final UIRuntime runtime;
  final HostPolicy policy;
  final bool Function(String id)? isKnownAttachment;
  List<AnswerBlock> _blocks = [];
  AnswerDecoder _decoder = AnswerDecoder();
  int? _openMarkdown;
  int _nextBlock = 1;
  final Map<String, String> _surfaceBlock = {};
  final Map<String, JsonMap> _pendingDecl = {};
  final Map<String, ({String catalogId, List<JsonMap> messages})> _log = {};
  final Set<String> _warned = {};
  int revision = 0;
  final Map<String, int> _artifactRevisions = {};
  int artifactRevision(String id) => _artifactRevisions[id] ?? 0;

  AnswerSession(
    this.runtime, {
    this.policy = const HostPolicy(),
    this.isKnownAttachment,
  });

  List<AnswerBlock> get blocks => List.unmodifiable(_blocks);

  void _touch() {
    revision++;
    _blocks = List.of(_blocks);
    notifyListeners();
  }

  void _warnOnce(String code, {bool error = false}) {
    if (_warned.add(code)) {
      runtime.report(code, severity: error ? 'error' : 'warning');
    }
  }

  String _newId() => 'b${_nextBlock++}';

  void push(String chunk) => _apply(_decoder.push(chunk));

  void beginTurn() {
    _closeMarkdown();
    _decoder = AnswerDecoder();
  }

  void _apply(List<AnswerItem> items) {
    for (final item in items) {
      switch (item.kind) {
        case 'text':
          pushMarkdown(item.text);
        case 'invalid':
          runtime.report('INVALID_JSON');
        default:
          _control(item.value!);
      }
    }
  }

  void pushMarkdown(String text) {
    if (policy.mode == 'engine-only') {
      if (text.trim().isNotEmpty) _warnOnce('POLICY_MARKDOWN_DISABLED');
      return;
    }
    var index = _openMarkdown;
    if (index == null) {
      if (text.trim().isEmpty) return;
      _blocks.add(MarkdownBlock(_newId(), ''));
      index = _blocks.length - 1;
      _openMarkdown = index;
      text = text.replaceFirst(RegExp(r'^\s+'), '');
    }
    final current = _blocks[index] as MarkdownBlock;
    _blocks[index] = current.copy(text: current.text + text);
    _touch();
  }

  void _closeMarkdown() {
    final index = _openMarkdown;
    if (index == null) return;
    final current = _blocks[index] as MarkdownBlock;
    _blocks[index] = current.copy(
      text: current.text.trimRight(),
      streaming: false,
    );
    _openMarkdown = null;
    _touch();
  }

  void declareSurface(JsonMap decl) =>
      _control({'engine': 'v1', 'block': 'surface', ...decl});
  void declareMedia(JsonMap decl) =>
      _control({'engine': 'v1', 'block': 'media', ...decl});
  void pushMessage(JsonMap message) => _control(message);

  void _control(JsonMap value) {
    if (value.containsKey('engine')) {
      _declaration(value);
    } else {
      _a2ui(value);
    }
  }

  void _declaration(JsonMap decl) {
    _closeMarkdown();
    if (decl['engine'] != 'v1') {
      runtime.report('INVALID_ENVELOPE');
      return;
    }
    switch (decl['block']) {
      case 'surface':
        final id = decl['surfaceId'];
        final fallback = decl['fallbackText'];
        if (id is! String ||
            id.isEmpty ||
            id.length > 128 ||
            fallback is! String ||
            fallback.isEmpty ||
            fallback.length > 4000) {
          runtime.report('INVALID_ENVELOPE');
          return;
        }
        if (policy.mode == 'markdown-only') {
          _warnOnce('POLICY_SURFACES_DISABLED');
          _surfaceBlock[id] = '';
          return;
        }
        if (_surfaceBlock.length >= policy.maxSurfaces) {
          _warnOnce('POLICY_MAX_SURFACES', error: true);
          _surfaceBlock[id] = '';
          return;
        }
        _pendingDecl[id] = decl;
      case 'media':
        if (!policy.allowMedia) {
          _warnOnce('POLICY_MEDIA_DISABLED');
          return;
        }
        final ids = (decl['attachments'] as List?)?.cast<String>() ?? const [];
        if (ids.isEmpty) {
          runtime.report('INVALID_ENVELOPE');
          return;
        }
        for (final id in ids) {
          if (!(isKnownAttachment?.call(id) ??
              runtime.attachments.get(id) != null)) {
            runtime.report('UNKNOWN_ATTACHMENT', path: id);
          }
        }
        _blocks.add(
          MediaBlock(
            _newId(),
            ids,
            decl['layout'] as String? ?? 'auto',
            decl['caption'] as String?,
            markdown: policy.mode == 'engine-only'
                ? null
                : decl['markdown'] as String?,
            placement: decl['placement'] as String? ?? 'below',
            mediaFraction: ((decl['mediaFraction'] as num?)?.toDouble() ?? 0.4)
                .clamp(0.25, 0.65),
          ),
        );
        _touch();
      case 'sandbox':
        _warnOnce('POLICY_SANDBOX_DISABLED', error: true);
        if (!policy.allowSandbox) {
          _blocks.add(
            SandboxBlock(
              _newId(),
              decl['mode'] as String? ?? 'html',
              decl['fallbackText'] as String? ?? '',
            ),
          );
          _touch();
        }
      default:
        runtime.report('INVALID_ENVELOPE');
    }
  }

  void _a2ui(JsonMap message) {
    final body =
        (message['createSurface'] ??
                message['updateComponents'] ??
                message['updateDataModel'] ??
                message['deleteSurface'])
            as Map?;
    final surfaceId = body?['surfaceId'] as String?;
    if (surfaceId != null && _surfaceBlock[surfaceId] == '') return;
    if (message.containsKey('createSurface') && surfaceId != null) {
      if (policy.mode == 'markdown-only') {
        _warnOnce('POLICY_SURFACES_DISABLED');
        _surfaceBlock[surfaceId] = '';
        return;
      }
      if (!_surfaceBlock.containsKey(surfaceId)) {
        if (_surfaceBlock.length >= policy.maxSurfaces) {
          _warnOnce('POLICY_MAX_SURFACES', error: true);
          _surfaceBlock[surfaceId] = '';
          return;
        }
        _closeMarkdown();
        final decl = _pendingDecl.remove(surfaceId);
        if (decl == null) _warnOnce('FALLBACK_TEXT_MISSING');
        final block = SurfaceBlock(
          _newId(),
          surfaceId,
          decl?['fallbackText'] as String? ?? '',
          decl == null ? 'generated' : 'model',
          decl?['title'] as String?,
          'streaming',
        );
        _blocks.add(block);
        _surfaceBlock[surfaceId] = block.id;
        _log[surfaceId] = (
          catalogId: (message['createSurface'] as Map)['catalogId'] as String,
          messages: <JsonMap>[],
        );
        _touch();
      }
    }
    final filtered = _filter(message);
    final copy = jsonDecode(jsonEncode(filtered)) as JsonMap;
    final before = runtime.diagnostics.length;
    final diagnostics = runtime.accept(copy);
    final accepted =
        diagnostics.isEmpty && runtime.diagnostics.length == before;
    if (surfaceId != null && accepted) {
      _log[surfaceId]?.messages.add(
        jsonDecode(jsonEncode(filtered)) as JsonMap,
      );
    }
    if (message.containsKey('deleteSurface') && surfaceId != null) {
      final id = _surfaceBlock.remove(surfaceId);
      _blocks = _blocks.where((b) => b.id != id).toList();
      _log.remove(surfaceId);
    }
    _touch();
  }

  JsonMap _filter(JsonMap message) {
    final allowed = policy.allowedComponents;
    final update = message['updateComponents'] as Map?;
    if (update == null) return message;
    final kept = <dynamic>[];
    for (final c in update['components'] as List) {
      if ((allowed == null || allowed.contains((c as Map)['component'])) &&
          (policy.allowMedia ||
              ![
                'Image',
                'Gallery',
                'Carousel',
                'MediaGrid',
                'ImageCompare',
                'ImageAnnotations',
                'Video',
                'Audio',
                'FileCard',
                'DocumentPreview',
              ].contains(c['component']))) {
        kept.add(c);
      } else {
        runtime.report(
          'COMPONENT_NOT_ALLOWED',
          surfaceId: update['surfaceId'] as String?,
          componentId: c['id'] as String?,
        );
      }
    }
    return {
      ...message,
      'updateComponents': {...update, 'components': kept},
    };
  }

  void end() {
    _apply(_decoder.finish());
    _closeMarkdown();
    runtime.finish();
    if (policy.mode == 'engine-only' && _blocks.isEmpty) {
      runtime.report('MISSING_ANSWER');
    }
    _blocks = [
      for (final block in _blocks)
        if (block is SurfaceBlock)
          block.copy(
            fallbackText: block.fallbackText.isEmpty
                ? describeSurface(runtime, block.surfaceId)
                : block.fallbackText,
            status:
                runtime.surface(block.surfaceId)?.componentsModel.get('root') ==
                    null
                ? 'error'
                : 'complete',
          )
        else
          block,
    ];
    _touch();
  }

  /// Plain text of the whole answer; surfaces contribute their fallback text.
  String asText() => _blocks
      .map(
        (b) => switch (b) {
          MarkdownBlock() => b.text,
          SurfaceBlock() =>
            b.fallbackText.isEmpty
                ? describeSurface(runtime, b.surfaceId)
                : b.fallbackText,
          SandboxBlock() => b.fallbackText,
          MediaBlock() => '[media: ${b.attachmentIds.join(', ')}]',
        },
      )
      .where((s) => s.isNotEmpty)
      .join('\n\n');

  /// Restore a surface to the data of its last completed model update.
  void reset(String surfaceId) {
    final log = _log[surfaceId];
    if (log == null) throw StateError('UNKNOWN_SURFACE');
    runtime.accept({
      'version': 'v0.9',
      'deleteSurface': {'surfaceId': surfaceId},
    });
    for (final message in log.messages) {
      runtime.accept(jsonDecode(jsonEncode(message)));
    }
    runtime.finish();
    _touch();
  }

  /// Preflight a revision before applying it; edited data remains protected by the runtime.
  Future<void> updateArtifact(
    String id,
    int expectedRevision, {
    String? text,
    List<JsonMap>? messages,
  }) async {
    final index = _blocks.indexWhere((b) => b.id == id);
    if (index < 0 || artifactRevision(id) != expectedRevision) {
      throw StateError('ARTIFACT_REVISION');
    }
    final block = _blocks[index];
    if (block is MarkdownBlock && text != null && text.length <= 65536) {
      _blocks[index] = block.copy(text: text, streaming: false);
    } else if (block is SurfaceBlock &&
        messages != null &&
        messages.length <= 100) {
      assertSafeJson(messages);
      final validation = await UIRuntime.create(
        schema: runtime.catalogSchema,
        prewarm: false,
      );
      try {
        for (final message in _log[block.surfaceId]!.messages) {
          validation.accept(jsonDecode(jsonEncode(message)));
        }
        validation.accept({
          'version': 'v0.9',
          'updateDataModel': {
            'surfaceId': block.surfaceId,
            'path': '/',
            'value': jsonDecode(jsonEncode(runtime.read(block.surfaceId, '/'))),
          },
        });
        for (final message in messages) {
          final body =
              message['updateComponents'] ?? message['updateDataModel'];
          if (body is! Map || body['surfaceId'] != block.surfaceId) {
            throw StateError('ARTIFACT_SCOPE');
          }
          if (validation.accept(message).any((d) => d['severity'] == 'error')) {
            throw StateError('ARTIFACT_INVALID');
          }
        }
        validation.finish();
        if (validation.diagnostics.any((d) => d['severity'] == 'error')) {
          throw StateError('ARTIFACT_INVALID');
        }
        if (artifactRevision(id) != expectedRevision ||
            !_blocks.any((b) => identical(b, block))) {
          throw StateError('ARTIFACT_REVISION');
        }
        for (final message in messages) {
          pushMessage(message);
        }
      } finally {
        validation.dispose();
      }
    } else {
      throw StateError('ARTIFACT_UPDATE');
    }
    _artifactRevisions[id] = expectedRevision + 1;
    _touch();
  }

  JsonMap serialize() =>
      _redactHistory({
            'schema': 2,
            'protocol': 'v0.9',
            'blocks': [
              for (final b in _blocks)
                {
                  ..._blockJson(b),
                  if (artifactRevision(b.id) > 0)
                    'revision': artifactRevision(b.id),
                },
            ],
            'surfaces': {
              for (final entry in _log.entries)
                entry.key: {
                  'catalogId': entry.value.catalogId,
                  'messages': entry.value.messages,
                  'data': jsonDecode(jsonEncode(runtime.read(entry.key, '/'))),
                },
            },
          })
          as JsonMap;

  static dynamic _redactHistory(dynamic value) {
    if (value is String) {
      return value.replaceAllMapped(
        RegExp(
          r'''(https?://[^\s"'<>?#]+)[?#][^\s"'<>]*''',
          caseSensitive: false,
        ),
        (m) => '${m[1]}?[redacted]',
      );
    }
    if (value is List) return value.map(_redactHistory).toList();
    if (value is Map) {
      return <String, dynamic>{
        for (final e in value.entries) e.key as String: _redactHistory(e.value),
      };
    }
    return value;
  }

  static JsonMap _blockJson(AnswerBlock b) => switch (b) {
    MarkdownBlock() => {
      'id': b.id,
      'kind': 'markdown',
      'text': b.text,
      'status': 'complete',
    },
    SurfaceBlock() => {
      'id': b.id,
      'kind': 'surface',
      'surfaceId': b.surfaceId,
      'fallbackText': b.fallbackText,
      'fallbackSource': b.fallbackSource,
      if (b.title != null) 'title': b.title,
      'status': b.status,
    },
    MediaBlock() => {
      'id': b.id,
      'kind': 'media',
      'attachmentIds': b.attachmentIds,
      'layout': b.layout,
      if (b.caption != null) 'caption': b.caption,
      if (b.markdown != null) 'markdown': b.markdown,
      'placement': b.placement,
      'mediaFraction': b.mediaFraction,
      'status': 'complete',
    },
    SandboxBlock() => {
      'id': b.id,
      'kind': 'sandbox',
      'mode': b.mode,
      'fallbackText': b.fallbackText,
      'status': 'blocked',
    },
  };

  /// Rebuild an answer from stored history of any supported schema (see [migrateSnapshot]).
  static AnswerSession restore(
    dynamic input,
    UIRuntime runtime, {
    HostPolicy policy = const HostPolicy(),
  }) {
    final snapshot = migrateSnapshot(input);
    final session = AnswerSession(runtime, policy: policy);
    final surfaces = snapshot['surfaces'] as Map;
    for (final raw in snapshot['blocks'] as List) {
      final b = raw as Map;
      final id = b['id'] as String;
      final revision = b['revision'] ?? 0;
      if (revision is! int || revision < 0) {
        throw StateError('ARTIFACT_REVISION');
      }
      session._artifactRevisions[id] = revision;
      session._nextBlock = [
        session._nextBlock,
        (int.tryParse(id.replaceAll(RegExp(r'\D'), '')) ?? 0) + 1,
      ].reduce((a, c) => a > c ? a : c);
      switch (b['kind']) {
        case 'markdown':
          session._blocks.add(
            MarkdownBlock(id, b['text'] as String, streaming: false),
          );
        case 'media':
          session._blocks.add(
            MediaBlock(
              id,
              (b['attachmentIds'] as List).cast<String>(),
              b['layout'] as String? ?? 'auto',
              b['caption'] as String?,
              markdown: b['markdown'] as String?,
              placement: b['placement'] as String? ?? 'below',
              mediaFraction: (b['mediaFraction'] as num?)?.toDouble() ?? 0.4,
            ),
          );
        case 'sandbox':
          session._blocks.add(
            SandboxBlock(
              id,
              b['mode'] as String? ?? 'html',
              b['fallbackText'] as String? ?? '',
            ),
          );
        case 'surface':
          final sid = b['surfaceId'] as String;
          session._blocks.add(
            SurfaceBlock(
              id,
              sid,
              b['fallbackText'] as String? ?? '',
              b['fallbackSource'] as String? ?? 'model',
              b['title'] as String?,
              'complete',
            ),
          );
          session._surfaceBlock[sid] = id;
          final stored = surfaces[sid] as Map?;
          if (stored == null) continue;
          final log = <JsonMap>[];
          for (final m in stored['messages'] as List) {
            final message = Map<String, dynamic>.from(m as Map);
            final diagnostics = runtime.accept(jsonDecode(jsonEncode(message)));
            if (diagnostics.isEmpty) log.add(message);
          }
          if (stored['data'] != null) {
            runtime.accept({
              'version': 'v0.9',
              'updateDataModel': {
                'surfaceId': sid,
                'path': '/',
                'value': jsonDecode(jsonEncode(stored['data'])),
              },
            });
          }
          session._log[sid] = (
            catalogId: stored['catalogId'] as String,
            messages: log,
          );
      }
    }
    runtime.finish();
    session._blocks = [
      for (final block in session._blocks)
        if (block is SurfaceBlock && block.fallbackText.isEmpty)
          block.copy(fallbackText: describeSurface(runtime, block.surfaceId))
        else
          block,
    ];
    session._touch();
    return session;
  }
}

/// Upgrade stored history to schema 2. Accepts schema 2, `{schema:1, messages}`, a bare list of
/// A2UI messages, or an NDJSON string (pre-hybrid history).
JsonMap migrateSnapshot(dynamic input) {
  dynamic value = input;
  if (value is String) {
    value = value
        .split('\n')
        .where((l) => l.trim().isNotEmpty)
        .map(jsonDecode)
        .toList();
  }
  if (value is List) value = <String, dynamic>{'schema': 1, 'messages': value};
  if (value is Map && value['schema'] == 1 && value['messages'] is List) {
    final surfaces = <String, Map<String, dynamic>>{};
    final blocks = <JsonMap>[];
    for (final m in value['messages'] as List) {
      final message = m as Map;
      final body =
          (message['createSurface'] ??
                  message['updateComponents'] ??
                  message['updateDataModel'] ??
                  message['deleteSurface'])
              as Map?;
      final id = body?['surfaceId'] as String?;
      if (id == null) continue;
      if (message.containsKey('createSurface')) {
        surfaces[id] = {
          'catalogId': (message['createSurface'] as Map)['catalogId'],
          'messages': <dynamic>[],
        };
        blocks.add({
          'id': 'b${blocks.length + 1}',
          'kind': 'surface',
          'surfaceId': id,
          'fallbackText': '',
          'fallbackSource': 'generated',
          'status': 'complete',
        });
      }
      (surfaces[id]?['messages'] as List?)?.add(message);
    }
    return {
      'schema': 2,
      'protocol': 'v0.9',
      'blocks': blocks,
      'surfaces': surfaces,
    };
  }
  if (value is Map && value['schema'] == 2) {
    return Map<String, dynamic>.from(value);
  }
  throw StateError('UNSUPPORTED_SNAPSHOT');
}

/// Plain-text equivalent of a surface (headings, text, control labels), capped at [limit] chars.
String describeSurface(UIRuntime runtime, String surfaceId, {int limit = 600}) {
  final surface = runtime.surface(surfaceId);
  if (surface == null) return '';
  final lines = <String>[];
  final seen = <String>{};
  String text(dynamic v) => v is String || v is num ? '$v' : '';
  void visit(String? id) {
    if (id == null || !seen.add(id) || lines.join('\n').length > limit) return;
    final node = runtime.node(surfaceId, id);
    final p = (node['props'] as Map?) ?? const {};
    switch (node['component']) {
      case 'Heading' || 'Text' || 'Badge':
        if (text(p['text']).isNotEmpty) lines.add(text(p['text']));
      case 'Callout':
        lines.add('${text(p['title'])}: ${text(p['text'])}'.trim());
      case 'Chart':
        lines.add('Chart: ${text(p['title'])}');
      case 'Table':
        lines.add('Table: ${text(p['caption'])}');
      case 'Button':
        lines.add('[${text(p['label'])}]');
      case 'Slider' || 'TextField' || 'Select' || 'Checkbox' || 'DatePicker':
        lines.add('${text(p['label'])}: ${text(p['value'])}'.trim());
      case 'Progress':
        lines.add('${text(p['label'])}: ${text(p['value'])}');
      default:
        if (text(p['title']).isNotEmpty) lines.add(text(p['title']));
    }
    final children = p['children'];
    if (children is List) {
      for (final child in children) {
        visit(child is String ? child : (child as Map?)?['id'] as String?);
      }
    }
    for (final tab in (p['tabs'] ?? p['items'] ?? const []) as List) {
      visit((tab as Map)['child'] as String?);
    }
  }

  visit('root');
  final out = lines.where((l) => l.isNotEmpty).join('\n');
  if (out.isEmpty) return 'Interactive content ($surfaceId)';
  return out.length > limit ? '${out.substring(0, limit - 1)}…' : out;
}
