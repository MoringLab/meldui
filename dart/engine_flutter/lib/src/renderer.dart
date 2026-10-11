import 'dart:math' as math;
import 'package:flutter/foundation.dart' show defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'learning.dart';
import 'runtime.dart';
import 'content.dart';
import 'markdown.dart';
import 'expression.dart';

typedef EngineWidgetBuilder =
    Widget Function(
      BuildContext,
      JsonMap,
      List<Widget>,
      UIRuntime,
      String,
      String,
    );

/// CSS-style numeric weight (100-900) to a Flutter weight.
FontWeight fontWeightFor(int w) =>
    FontWeight.values[((w / 100).round().clamp(1, 9)) - 1];
final _colorCache = <String, Color>{};
Color _color(String value) {
  final cached = _colorCache[value];
  if (cached != null) return cached;
  final parsed = Color(int.parse(value.replaceFirst('#', 'ff'), radix: 16));
  if (_colorCache.length < 256) _colorCache[value] = parsed;
  return parsed;
}

/// Inherited host configuration; switching kits does not recreate a runtime.
class UIProvider extends InheritedWidget {
  final UIRuntime runtime;
  final ContentHost? content;
  final UIKit kit;
  final bool dark;
  final Map<String, ImageProvider> assets;
  final Map<String, EngineWidgetBuilder> components;

  /// Called with true while a control is being dragged and false when it ends, so a host list
  /// can stop scrolling during the drag.
  final void Function(bool locked)? onGestureLock;
  const UIProvider({
    super.key,
    required this.runtime,
    required this.kit,
    this.dark = false,
    this.assets = const {},
    this.content,
    this.components = const {},
    this.onGestureLock,
    required super.child,
  });
  static UIProvider of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<UIProvider>()!;
  @override
  bool updateShouldNotify(UIProvider oldWidget) =>
      content != oldWidget.content ||
      runtime != oldWidget.runtime ||
      kit != oldWidget.kit ||
      dark != oldWidget.dark ||
      assets != oldWidget.assets ||
      components != oldWidget.components;
}

/// Display one or every active A2UI surface with native Flutter widgets.
class UIComponent extends StatelessWidget {
  final String surfaceId, componentId, scope;
  const UIComponent({
    super.key,
    required this.surfaceId,
    required this.componentId,
    this.scope = '/',
  });
  @override
  Widget build(BuildContext context) =>
      _Node(sid: surfaceId, id: componentId, scope: scope);
}

class UISurface extends StatelessWidget {
  final String? surfaceId;
  const UISurface({super.key, this.surfaceId});
  @override
  Widget build(BuildContext context) {
    final host = UIProvider.of(context);
    final ty = host.kit.typography(
      ios: defaultTargetPlatform == TargetPlatform.iOS,
    );
    return DefaultTextStyle.merge(
      style: TextStyle(
        color: _color(host.kit.colors(host.dark)['foreground'] as String),
        fontSize: ty.bodySize,
        height: ty.bodyLineHeight / ty.bodySize,
        fontWeight: fontWeightFor(ty.bodyWeight),
        fontFamily: ty.bodyFamily,
      ),
      child: ListenableBuilder(
        listenable: host.runtime,
        builder: (context, _) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final id
                in surfaceId == null ? host.runtime.surfaceIds : [surfaceId!])
              _Node(
                key: ValueKey('${identityHashCode(host.runtime)}:$id'),
                sid: id,
                id: 'root',
              ),
          ],
        ),
      ),
    );
  }
}

class _Node extends StatefulWidget {
  final String sid;
  final String id;
  final String scope;
  const _Node({
    super.key,
    required this.sid,
    required this.id,
    this.scope = '/',
  });
  @override
  State<_Node> createState() => _NodeState();
}

class _NodeState extends State<_Node> {
  UIRuntime? runtime;
  VoidCallback? unsubscribe;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = UIProvider.of(context).runtime;
    if (next != runtime) {
      unsubscribe?.call();
      runtime = next;
      unsubscribe = next.subscribeNode(widget.sid, widget.id, widget.scope, () {
        if (mounted) setState(() {});
      });
    }
  }

  @override
  void dispose() {
    unsubscribe?.call();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final host = UIProvider.of(context);
    final node = runtime!.node(widget.sid, widget.id, widget.scope);
    final colors = host.kit.colors(host.dark);
    final border = _color(colors['border'] as String);
    if (node['error'] != null) {
      return Semantics(
        liveRegion: true,
        child: Text(
          '이 항목을 표시할 수 없습니다. ${node['error']}',
          style: TextStyle(color: _color(colors['danger'] as String)),
        ),
      );
    }
    if (node['component'] == null) {
      return Semantics(
        label: '콘텐츠 불러오는 중',
        child: Container(
          height: 24,
          margin: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: border.withValues(alpha: .4),
            borderRadius: BorderRadius.circular(6),
          ),
        ),
      );
    }
    final props = Map<String, dynamic>.from(node['props'] as Map);
    if (props['visible'] == false) return const SizedBox.shrink();
    Widget child(String id, [String? scope]) => _Node(
      key: ValueKey('$id:${scope ?? widget.scope}'),
      sid: widget.sid,
      id: id,
      scope: scope ?? widget.scope,
    );
    final children = <Widget>[];
    final childList = props['children'];
    if (childList is List) {
      children.addAll(childList.map((id) => child(id as String)));
    } else if (childList is Map) {
      final values = runtime!.read(
        widget.sid,
        childList['path'] as String,
        widget.scope,
      );
      if (values is List) {
        for (var i = 0; i < math.min(values.length, 1000); i++) {
          children.add(
            child(
              childList['componentId'] as String,
              '${resolvePath(childList['path'] as String, widget.scope)}/$i',
            ),
          );
        }
      }
    }
    final config = host.kit.manifest['components'][node['component']] as Map?;
    final custom =
        host.components[config?['implementation']] ??
        host.components[node['component']] ??
        host.components[config?['fallback']];
    if (custom != null) {
      return custom(
        context,
        node,
        children,
        runtime!,
        widget.sid,
        widget.scope,
      );
    }
    return _Component(
      node: node,
      sid: widget.sid,
      scope: widget.scope,
      renderChild: child,
      children: children,
    );
  }
}

class _Component extends StatefulWidget {
  final JsonMap node;
  final List<Widget> children;
  final String sid;
  final String scope;
  final Widget Function(String, [String?]) renderChild;
  const _Component({
    required this.node,
    required this.children,
    required this.sid,
    required this.scope,
    required this.renderChild,
  });
  @override
  State<_Component> createState() => _ComponentState();
}

class _ComponentState extends State<_Component> {
  bool showData = false;
  @override
  Widget build(BuildContext context) {
    final host = UIProvider.of(context);
    final runtime = host.runtime;
    final node = widget.node;
    final p = Map<String, dynamic>.from(node['props'] as Map);
    final colors = host.kit.colors(host.dark);
    final ty = host.kit.typography(
      ios: defaultTargetPlatform == TargetPlatform.iOS,
    );
    final foreground = _color(colors['foreground'] as String);
    final muted = _color(colors['muted'] as String);
    final accent = _color(colors['accent'] as String);
    final border = _color(colors['border'] as String);
    final surface = _color(colors['surface'] as String);
    final raw = node['raw'] as Map;
    final binding = raw['value'];
    final bound = binding is Map && binding['path'] is String;
    final disabled = p['disabled'] == true || !bound;
    final value = p['value'];
    final label = displayValue(p['label']);
    void write(dynamic next) {
      if (bound) {
        runtime.setValue(
          widget.sid,
          binding['path'] as String,
          next,
          widget.scope,
        );
      }
    }

    Future<void> dispatch(dynamic action) => runtime.dispatch(
      widget.sid,
      node['id'] as String,
      Map<String, dynamic>.from(action as Map),
      widget.scope,
    );
    final gap =
        ((host.kit.manifest['tokens']['spacing'][p['gap'] ?? 'md'] ?? 16)
                as num)
            .toDouble();
    Widget column(List<Widget> children, [double spacing = 16]) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) SizedBox(height: spacing),
          children[i],
        ],
      ],
    );
    Widget field(Widget control) => column([
      Text(
        label,
        style: TextStyle(fontSize: ty.smallSize, fontWeight: FontWeight.w600),
      ),
      control,
      if (p['error'] != null)
        Text(
          displayValue(p['error']),
          style: TextStyle(color: _color(colors['danger'] as String)),
        ),
    ], 8);
    Widget button(String title, VoidCallback? press, {bool secondary = false}) {
      final style = ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(Size(48, 48)),
        padding: const WidgetStatePropertyAll(
          EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        ),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(
              host.kit.manifest['components'][node['component']]['implementation'] ==
                      'Editorial${node['component']}'
                  ? 4
                  : 8,
            ),
          ),
        ),
        foregroundColor: WidgetStatePropertyAll(
          secondary ? foreground : _color(colors['onAccent'] as String),
        ),
        backgroundColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.disabled)
              ? border
              : secondary
              ? surface
              : accent,
        ),
      );
      return secondary
          ? OutlinedButton(onPressed: press, style: style, child: Text(title))
          : FilledButton(onPressed: press, style: style, child: Text(title));
    }

    if (learningNames.contains(node['component'])) {
      return LearningView(
        node: node,
        sid: widget.sid,
        scope: widget.scope,
        children: widget.children,
      );
    }
    switch (node['component']) {
      case 'Form':
        return Semantics(
          label: label,
          child: column([
            ...widget.children,
            button('제출', () {
              dispatch(p['onSubmit']);
            }, secondary: true),
          ]),
        );
      case 'Column':
        return column(widget.children, gap);
      case 'Row':
        return LayoutBuilder(
          builder: (context, constraints) => Wrap(
            spacing: gap,
            runSpacing: gap,
            children: [
              for (final child in widget.children)
                SizedBox(
                  width: widget.children.length == 1
                      ? constraints.maxWidth
                      : math.max(120, (constraints.maxWidth - gap) / 2),
                  child: child,
                ),
            ],
          ),
        );
      case 'Grid':
        return LayoutBuilder(
          builder: (context, constraints) {
            final count = constraints.maxWidth < 560
                ? 1
                : (p['columns'] as num? ?? 2).toInt();
            return Wrap(
              spacing: gap,
              runSpacing: gap,
              children: [
                for (final child in widget.children)
                  SizedBox(
                    width: (constraints.maxWidth - gap * (count - 1)) / count,
                    child: child,
                  ),
              ],
            );
          },
        );
      case 'Card':
        return Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: surface,
            border: Border.all(color: border),
            borderRadius: BorderRadius.circular(host.kit.radius),
          ),
          child: column([
            if (p['title'] != null) ...[
              Semantics(
                header: true,
                child: Text(
                  displayValue(p['title']),
                  style: TextStyle(
                    fontSize: ty.headingSizes[3],
                    fontWeight: FontWeight.w600,
                    fontFamily: ty.headingFamily,
                  ),
                ),
              ),
              if (host
                      .kit
                      .manifest['components'][node['component']]['implementation'] ==
                  'Editorial${node['component']}')
                Divider(color: border),
            ],
            ...widget.children,
          ]),
        );
      case 'Divider':
        return Divider(color: border);
      case 'Heading':
        final headingLevel = ((p['level'] as num? ?? 2).toInt() - 1).clamp(
          0,
          5,
        );
        return Semantics(
          header: true,
          child: Text(
            displayValue(p['text']),
            key: ValueKey('node-${node['id']}'),
            style: TextStyle(
              fontSize: ty.headingSizes[headingLevel],
              height:
                  ty.headingLineHeights[headingLevel] /
                  ty.headingSizes[headingLevel],
              fontWeight: fontWeightFor(ty.headingWeight),
              fontFamily: ty.headingFamily,
            ),
          ),
        );
      case 'Text':
        return Text(
          displayValue(p['text']),
          key: ValueKey('node-${node['id']}'),
          style: TextStyle(
            color: p['tone'] == 'muted'
                ? muted
                : p['tone'] == 'danger'
                ? _color(colors['danger'] as String)
                : p['tone'] == 'success'
                ? _color(colors['success'] as String)
                : foreground,
          ),
        );
      case 'Markdown':
        return safeMarkdown(context, '${p['text'] ?? ''}', false);
      case 'Gallery':
      case 'Carousel':
      case 'MediaGrid':
      case 'ImageCompare':
        return MediaContent(
          ids: List<String>.from(p['attachmentIds']),
          layout: node['component'] == 'Carousel'
              ? 'carousel'
              : node['component'] == 'MediaGrid'
              ? 'grid'
              : node['component'] == 'ImageCompare'
              ? 'compare'
              : p['layout'] as String? ?? 'auto',
          caption: p['caption'] as String?,
        );
      case 'Video':
      case 'Audio':
      case 'FileCard':
      case 'DocumentPreview':
      case 'ImageAnnotations':
        return AttachmentMedia(
          id: p['attachmentId'] as String,
          caption: p['caption'] as String?,
          seek: (p['seek'] as num?)?.toDouble(),
          muted: p['muted'] as bool? ?? true,
          file: ['FileCard', 'DocumentPreview'].contains(node['component']),
          regionIds: List<String>.from(p['regionIds'] as List? ?? []),
        );
      case 'Image':
        if (p['attachmentId'] != null) {
          return AttachmentMedia(
            id: p['attachmentId'] as String,
            alt: p['alt'] as String?,
            caption: p['caption'] as String?,
          );
        }
        final image = host.assets[p['asset']];
        return image != null
            ? Image(
                image: image,
                semanticLabel: p['alt'] as String,
                fit: BoxFit.contain,
              )
            : Semantics(
                image: true,
                label: p['alt'] as String,
                child: Container(
                  padding: const EdgeInsets.all(28),
                  decoration: BoxDecoration(border: Border.all(color: border)),
                  child: Text(
                    p['alt'] as String,
                    style: TextStyle(color: muted),
                  ),
                ),
              );
      case 'Icon':
        return Icon(
          {
                'check': Icons.check,
                'info': Icons.info_outline,
                'arrow': Icons.arrow_forward,
                'plus': Icons.add,
                'star': Icons.star_outline,
                'close': Icons.close,
              }[p['name']] ??
              Icons.info_outline,
          color: foreground,
          semanticLabel: p['label'] as String?,
        );
      case 'Badge':
        return Align(
          alignment: AlignmentDirectional.centerStart,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
            decoration: BoxDecoration(
              border: Border.all(color: border),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              displayValue(p['text']),
              style: TextStyle(
                fontSize: 13,
                color: p['tone'] == 'success'
                    ? _color(colors['success'] as String)
                    : foreground,
              ),
            ),
          ),
        );
      case 'Callout':
        return Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: surface,
            border: Border.all(color: border),
            borderRadius: BorderRadius.circular(host.kit.radius),
          ),
          child: column([
            if (p['title'] != null)
              Text(
                displayValue(p['title']),
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            Text(displayValue(p['text'])),
          ], 6),
        );
      case 'CodeBlock':
        return Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: surface,
            border: Border.all(color: border),
            borderRadius: BorderRadius.circular(6),
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SelectableText(
              displayValue(p['code']),
              style: const TextStyle(fontFamily: 'monospace', fontSize: 14),
            ),
          ),
        );
      case 'List':
        return column([
          for (var i = 0; i < widget.children.length; i++)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (p['ordered'] == true)
                  Padding(
                    padding: const EdgeInsets.only(right: 12),
                    child: Text('${i + 1}.'),
                  ),
                Expanded(child: widget.children[i]),
              ],
            ),
        ], 10);
      case 'Table':
        return _DataTable(
          caption: displayValue(p['caption']),
          columns: p['columns'] as List,
          rows: p['rows'],
        );
      case 'Progress':
        return Semantics(
          value: '${displayValue(value)} / ${p['max'] ?? 100}',
          label: label,
          child: column([
            Text('$label: ${displayValue(value)} / ${p['max'] ?? 100}'),
            // Motion follows the kit token and drops to zero under the OS reduced-motion setting.
            TweenAnimationBuilder<double>(
              tween: Tween(
                end: ((value as num? ?? 0) / (p['max'] as num? ?? 100))
                    .clamp(0, 1)
                    .toDouble(),
              ),
              duration: Duration(
                milliseconds: MediaQuery.of(context).disableAnimations
                    ? 0
                    : host.kit.motionMs,
              ),
              curve: Curves.easeOutQuad,
              builder: (context, ratio, _) => LinearProgressIndicator(
                value: ratio,
                backgroundColor: border,
                color: accent,
              ),
            ),
          ], 8),
        );
      case 'Button':
        return Align(
          alignment: AlignmentDirectional.centerStart,
          child: button(
            label,
            p['disabled'] == true
                ? null
                : () {
                    dispatch(p['action']);
                  },
            secondary: p['variant'] != null && p['variant'] != 'primary',
          ),
        );
      case 'TextField':
        return field(
          _BoundTextField(
            key: ValueKey<String>(node['id'] as String),
            label: label,
            value: displayValue(value),
            disabled: disabled,
            multiline: p['multiline'] == true,
            placeholder: p['placeholder'] as String?,
            onChanged: write,
          ),
        );
      case 'Select':
        return field(
          DropdownButtonFormField<String>(
            key: ValueKey('${node['id']}:$value'),
            initialValue: value as String?,
            isExpanded: true,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              contentPadding: EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 14,
              ),
            ),
            items: (p['options'] as List)
                .map(
                  (option) => DropdownMenuItem(
                    value: option['value'] as String,
                    child: Text(option['label'] as String),
                  ),
                )
                .toList(),
            onChanged: disabled ? null : write,
          ),
        );
      case 'Checkbox':
        return Material(
          color: Colors.transparent,
          child: CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(label),
            value: value == true,
            controlAffinity: ListTileControlAffinity.leading,
            onChanged: disabled ? null : write,
          ),
        );
      case 'Slider':
        final min = (p['min'] as num? ?? 0).toDouble();
        final max = (p['max'] as num? ?? 100).toDouble();
        final step = (p['step'] as num? ?? 1).toDouble();
        if (max <= min) {
          return Text(
            '잘못된 조절 범위',
            style: TextStyle(color: _color(colors['danger'] as String)),
          );
        }
        return field(
          column([
            Semantics(
              label: label,
              child: Slider(
                key: ValueKey('input-${node['id']}'),
                value: (value as num? ?? min).toDouble().clamp(min, max),
                min: min,
                max: max,
                divisions: ((max - min) / step).round().clamp(1, 10000),
                label: displayValue(value),
                onChangeStart: (_) => host.onGestureLock?.call(true),
                onChangeEnd: (_) => host.onGestureLock?.call(false),
                onChanged: disabled
                    ? null
                    : (v) => write((v / step).round() * step),
              ),
            ),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: Text(
                displayValue(value),
                key: ValueKey('value-${node['id']}'),
              ),
            ),
          ], 0),
        );
      case 'DatePicker':
        return field(
          button(
            displayValue(value).isEmpty ? '날짜 선택' : displayValue(value),
            disabled
                ? null
                : () async {
                    final first =
                        DateTime.tryParse(p['min'] as String? ?? '') ??
                        DateTime(1900);
                    final last =
                        DateTime.tryParse(p['max'] as String? ?? '') ??
                        DateTime(2100);
                    var initial =
                        DateTime.tryParse(displayValue(value)) ??
                        DateTime.now();
                    if (initial.isBefore(first)) initial = first;
                    if (initial.isAfter(last)) initial = last;
                    final selected = await showDatePicker(
                      context: context,
                      initialDate: initial,
                      firstDate: first,
                      lastDate: last,
                    );
                    if (selected != null) {
                      write(
                        '${selected.year}-${selected.month.toString().padLeft(2, '0')}-${selected.day.toString().padLeft(2, '0')}',
                      );
                    }
                  },
            secondary: true,
          ),
        );
      case 'Tabs':
        final tabs = p['tabs'] as List;
        final selected =
            tabs.firstWhere(
                  (tab) => tab['id'] == value,
                  orElse: () => tabs.first,
                )
                as Map;
        return column([
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final tab in tabs)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(end: 8),
                    child: Semantics(
                      selected: tab['id'] == selected['id'],
                      child: button(
                        displayValue(
                          runtime.resolve(
                            widget.sid,
                            tab['label'],
                            widget.scope,
                          ),
                        ),
                        () => write(tab['id']),
                        secondary: tab['id'] != selected['id'],
                      ),
                    ),
                  ),
              ],
            ),
          ),
          widget.renderChild(selected['child'] as String),
        ]);
      case 'Accordion':
        return column([
          for (final item in p['items'] as List)
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Semantics(
                  expanded: value == item['id'],
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      displayValue(
                        runtime.resolve(
                          widget.sid,
                          item['label'],
                          widget.scope,
                        ),
                      ),
                    ),
                    trailing: Icon(
                      value == item['id'] ? Icons.remove : Icons.add,
                    ),
                    onTap: () => write(value == item['id'] ? '' : item['id']),
                  ),
                ),
                if (value == item['id'])
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: widget.renderChild(item['child'] as String),
                  ),
                Divider(color: border),
              ],
            ),
        ], 0);
      case 'Chart':
        return column([
          Text(
            displayValue(p['title']),
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          ),
          Semantics(
            image: true,
            label: '${displayValue(p['title'])}. 아래 데이터 표에서 값을 확인하세요.',
            child: SizedBox(
              height: 220,
              child: CustomPaint(
                painter: _ChartPainter(p, accent, border, muted),
              ),
            ),
          ),
          button(
            showData ? '데이터 표 닫기' : '데이터 표 보기',
            () => setState(() => showData = !showData),
            secondary: true,
          ),
          if (showData)
            _DataTable(
              caption: displayValue(p['title']),
              columns: [
                {'key': p['xKey'] ?? 'x', 'label': p['xKey'] ?? 'x'},
                {'key': p['yKey'] ?? 'y', 'label': p['yKey'] ?? 'y'},
              ],
              rows: p['values'],
            ),
        ], 12);
      default:
        return Text('등록되지 않은 컴포넌트: ${node['component']}');
    }
  }
}

class _BoundTextField extends StatefulWidget {
  final String label, value;
  final bool disabled, multiline;
  final String? placeholder;
  final ValueChanged<String> onChanged;
  const _BoundTextField({
    super.key,
    required this.label,
    required this.value,
    required this.disabled,
    required this.multiline,
    this.placeholder,
    required this.onChanged,
  });
  @override
  State<_BoundTextField> createState() => _BoundTextFieldState();
}

class _BoundTextFieldState extends State<_BoundTextField> {
  late final controller = TextEditingController(text: widget.value);
  @override
  void didUpdateWidget(_BoundTextField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (controller.text != widget.value) {
      controller.value = TextEditingValue(
        text: widget.value,
        selection: TextSelection.collapsed(offset: widget.value.length),
      );
    }
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Semantics(
    label: widget.label,
    child: TextField(
      controller: controller,
      enabled: !widget.disabled,
      minLines: widget.multiline ? 3 : 1,
      maxLines: widget.multiline ? 6 : 1,
      decoration: InputDecoration(
        hintText: widget.placeholder,
        border: const OutlineInputBorder(),
        contentPadding: const EdgeInsets.all(12),
      ),
      onChanged: widget.onChanged,
    ),
  );
}

dynamic _tableValue(dynamic row, String key) {
  if (row is Map) return row[key];
  final index = int.tryParse(key);
  if (row is List && index != null && index >= 0 && index < row.length) {
    return row[index];
  }
  return null;
}

class _DataTable extends StatelessWidget {
  final String caption;
  final List columns;
  final dynamic rows;
  const _DataTable({
    required this.caption,
    required this.columns,
    required this.rows,
  });
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(caption, style: const TextStyle(fontSize: 14)),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          columns: columns
              .map((c) => DataColumn(label: Text(c['label'] as String)))
              .toList(),
          rows: (rows is List ? rows as List : [])
              .map(
                (row) => DataRow(
                  cells: columns
                      .map(
                        (c) => DataCell(
                          Text(
                            displayValue(_tableValue(row, c['key'] as String)),
                          ),
                        ),
                      )
                      .toList(),
                ),
              )
              .toList(),
        ),
      ),
    ],
  );
}

class _ChartPainter extends CustomPainter {
  final JsonMap props;
  final Color accent, border, muted;
  _ChartPainter(this.props, this.accent, this.border, this.muted);
  @override
  void paint(Canvas canvas, Size size) {
    final xKey = props['xKey'] ?? 'x', yKey = props['yKey'] ?? 'y';
    final values = (props['values'] is List ? props['values'] as List : [])
        .where((p) => p is Map && p[yKey] is num && (p[yKey] as num).isFinite)
        .toList();
    if (values.isEmpty) return;
    final min = values.fold<num>(0, (v, p) => math.min(v, p[yKey] as num));
    final max = values.fold<num>(1, (v, p) => math.max(v, p[yKey] as num));
    final numericX =
        props['kind'] == 'scatter' && values.every((v) => v[xKey] is num);
    final xs = numericX
        ? values.map((v) => (v[xKey] as num).toDouble()).toList()
        : <double>[];
    final minX = xs.isEmpty ? 0.0 : xs.reduce(math.min);
    final maxX = xs.isEmpty ? 1.0 : xs.reduce(math.max);
    double x(int i) =>
        36 +
        (numericX
                ? (xs[i] - minX) / (maxX == minX ? 1 : maxX - minX)
                : i / math.max(values.length - 1, 1)) *
            (size.width - 60);
    double y(num v) =>
        size.height - 40 - (v - min) / (max - min) * (size.height - 68);
    void label(String text, Offset position, {bool center = false}) {
      final painter = TextPainter(
        text: TextSpan(
          text: text,
          style: TextStyle(color: muted, fontSize: 11),
        ),
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: 70);
      painter.paint(
        canvas,
        position - Offset(center ? painter.width / 2 : painter.width, 0),
      );
    }

    for (final f in [0, .5, 1]) {
      final v = min + (max - min) * f;
      canvas.drawLine(
        Offset(36, y(v)),
        Offset(size.width - 12, y(v)),
        Paint()..color = border,
      );
      label(displayValue((v * 10).round() / 10), Offset(29, y(v) - 7));
    }
    final path = Path();
    for (var i = 0; i < values.length; i++) {
      final point = Offset(x(i), y(values[i][yKey] as num));
      if (i == 0) {
        path.moveTo(point.dx, point.dy);
      } else {
        path.lineTo(point.dx, point.dy);
      }
      if (props['kind'] == 'bar') {
        final width = math.min(28.0, (size.width - 60) / values.length * .7);
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromLTRB(
              point.dx - width / 2,
              math.min(y(0), point.dy),
              point.dx + width / 2,
              math.max(y(0), point.dy),
            ),
            const Radius.circular(2),
          ),
          Paint()..color = accent,
        );
      } else {
        canvas.drawCircle(point, 4, Paint()..color = accent);
      }
      label(
        displayValue(values[i][xKey]),
        Offset(x(i), size.height - 20),
        center: true,
      );
    }
    if (props['kind'] == 'line') {
      canvas.drawPath(
        path,
        Paint()
          ..color = accent
          ..strokeWidth = 3
          ..style = PaintingStyle.stroke,
      );
    }
  }

  @override
  bool shouldRepaint(_ChartPainter oldDelegate) =>
      oldDelegate.props != props || oldDelegate.accent != accent;
}
