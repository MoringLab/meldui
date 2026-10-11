import 'dart:math' as math;
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'renderer.dart';
import 'markdown.dart';
import 'expression.dart';

const learningNames = [
  'Confirmation',
  'ControlPanel',
  'Stat',
  'StatGroup',
  'Legend',
  'Formula',
  'Annotation',
  'Walkthrough',
  'Quiz',
  'Timeline',
  'Playback',
  'SvgScene',
  'Plot',
  'RouteMap',
  'Simulation',
];

class LearningView extends StatefulWidget {
  final Map<String, dynamic> node;
  final List<Widget> children;
  final String sid, scope;
  const LearningView({
    super.key,
    required this.node,
    required this.children,
    required this.sid,
    required this.scope,
  });
  @override
  State<LearningView> createState() => _LearningViewState();
}

class _LearningViewState extends State<LearningView> {
  int? selected;
  double time = 0;
  int frame = 0;
  @override
  Widget build(BuildContext context) {
    final host = UIProvider.of(context), runtime = host.runtime;
    final p = widget.node['props'] as Map;
    final colors = host.kit.colors(host.dark);
    Widget text(dynamic v) => Text('${v ?? ''}');
    Widget column(List<Widget> c) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final x in c)
          Padding(padding: const EdgeInsets.only(bottom: 12), child: x),
      ],
    );
    Widget button(String label, VoidCallback? call) =>
        OutlinedButton(onPressed: call, child: Text(label));
    void choose(int v) {
      setState(() => selected = v);
      final raw = widget.node['raw']['value'];
      if (raw is Map && raw['path'] is String) {
        runtime.setValue(widget.sid, raw['path'], v, widget.scope);
      }
    }

    final bound = widget.node['raw']['value'];
    final index = bound is Map && bound['path'] is String
        ? (p['value'] as num? ?? 0).toInt()
        : selected ?? (p['value'] as num? ?? 0).toInt();
    switch (widget.node['component']) {
      case 'Confirmation':
        return column([
          text(p['title']),
          text(p['detail']),
          button(
            p['label'],
            () => runtime.dispatch(
              widget.sid,
              widget.node['id'],
              Map<String, dynamic>.from(p['action']),
              widget.scope,
            ),
          ),
        ]);
      case 'ControlPanel':
        return column([
          if (p['title'] != null) text(p['title']),
          ...widget.children,
        ]);
      case 'StatGroup':
        return Wrap(spacing: 16, runSpacing: 16, children: widget.children);
      case 'Stat':
        return Semantics(
          liveRegion: true,
          child: column([
            text(p['label']),
            text(
              '${p['value'] is num ? evaluateExpression({
                      'op': 'numberFormat',
                      'args': [p['value'], p['precision'] ?? 2, true],
                    }, (_) => null) : p['value']} ${p['unit'] ?? ''}',
            ),
          ]),
        );
      case 'Legend':
        return column([for (final x in p['items']) text(x['label'])]);
      case 'Formula':
        return column([
          safeMarkdown(
            context,
            '\u0024\u0024\n${p['latex']}\n\u0024\u0024',
            false,
          ),
          text(p['meaning']),
        ]);
      case 'Annotation':
        return text(p['text']);
      case 'Walkthrough':
        final steps = p['steps'] as List;
        return column([
          text(steps[index]['title']),
          text(steps[index]['text']),
          button('Previous step', index > 0 ? () => choose(index - 1) : null),
          button(
            'Next step',
            index < steps.length - 1 ? () => choose(index + 1) : null,
          ),
        ]);
      case 'Quiz':
        final choices = p['choices'] as List;
        return column([
          text(p['prompt']),
          for (var i = 0; i < choices.length; i++)
            button('${choices[i]}', () => choose(i)),
          if (index >= 0)
            Semantics(
              liveRegion: true,
              child: text(
                '${index == p['correctIndex'] ? 'Correct.' : 'Try again.'} ${p['explanation']}',
              ),
            ),
        ]);
      case 'Timeline':
        return column([
          for (final x in p['items'])
            column([
              text(x['label']),
              text(x['detail']),
              if (x['action'] != null)
                button(
                  'Open ${x['label']}',
                  () => runtime.dispatch(
                    widget.sid,
                    widget.node['id'],
                    Map<String, dynamic>.from(x['action']),
                    widget.scope,
                  ),
                ),
            ]),
        ]);
      case 'Playback':
        final saved = runtime.read(widget.sid, p['path'], widget.scope);
        if (saved is Map && saved[r'$time'] is num && saved[r'$frame'] is num) {
          time = (saved[r'$time'] as num).toDouble();
          frame = (saved[r'$frame'] as num).toInt();
        }
        void write() {
          for (final x in {
            '\u0024time': time,
            '\u0024dt': 1 / 30,
            '\u0024frame': frame,
          }.entries) {
            runtime.setValue(
              widget.sid,
              "${p['path']}/${x.key}",
              x.value,
              widget.scope,
            );
          }
        }
        return column([
          button('Step', () {
            time += 1 / 30;
            frame++;
            write();
          }),
          button('Reset clock', () {
            time = 0;
            frame = 0;
            write();
          }),
          text(
            'Manual clock (continuous playback requires host visibility control)',
          ),
        ]);
      case 'Simulation':
        return text(
          '${p['title']}: simulation requires the web renderer. ${p['module']}, seed ${p['seed']}.',
        );
      case 'SvgScene':
        final sceneActions = <Widget>[];
        var count = 0;
        final prefix =
            "scene-${widget.sid.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_')}-${('${widget.node['id']}').replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_')}";
        String escape(dynamic x) =>
            const HtmlEscape(HtmlEscapeMode.attribute).convert('$x');
        String scene(
          List nodes,
          int depth, [
          Map<String, dynamic> locals = const {},
        ]) {
          dynamic value(dynamic v) => v is Map && v['call'] is String
              ? evaluateExpression(
                  v['args']['expr'],
                  (path) => locals.containsKey(path)
                      ? locals[path]
                      : runtime.read(widget.sid, path, widget.scope),
                )
              : runtime.resolve(widget.sid, v, widget.scope);
          if (depth > 12) throw StateError('SCENE_DEPTH');
          return nodes.map((n) {
            if (++count > 300) throw StateError('SCENE_ELEMENT_LIMIT');
            final type = n['type'];
            final sceneAction = n['action'] ?? n['onHover'];
            if (sceneAction is Map) {
              sceneActions.add(
                button(
                  n['label'] is String
                      ? n['label']
                      : n['text'] is String
                      ? n['text']
                      : 'Scene action ${sceneActions.length + 1}',
                  () => runtime.dispatch(
                    widget.sid,
                    widget.node['id'],
                    Map<String, dynamic>.from(sceneAction),
                    widget.scope,
                  ),
                ),
              );
            }
            if (type == 'repeat') {
              final items = value(n['items']) as List;
              if (items.length > 300) throw StateError('SCENE_REPEAT_LIMIT');
              return items
                  .asMap()
                  .entries
                  .map(
                    (entry) => scene(n['children'] ?? [], depth + 1, {
                      ...locals,
                      r'$item': entry.value,
                      r'$index': entry.key,
                    }),
                  )
                  .join();
            }
            final tag = type == 'group' ? 'g' : type;
            final rawAttrs = Map<String, dynamic>.from(
              n['attrs'] as Map? ?? {},
            );
            if (n['transforms'] is List) {
              num finite(dynamic v, num fallback) {
                final result = v == null ? fallback : value(v);
                if (result is! num ||
                    !result.isFinite ||
                    result.abs() > 100000) {
                  throw StateError('SCENE_TRANSFORM');
                }
                return result;
              }

              rawAttrs['transform'] = [
                rawAttrs['transform'] ?? '',
                ...(n['transforms'] as List).map(
                  (t) => t['kind'] == 'translate'
                      ? 'translate(${finite(t['x'], 0)},${finite(t['y'], 0)})'
                      : t['kind'] == 'rotate'
                      ? 'rotate(${finite(t['angle'], 0)},${finite(t['cx'], 0)},${finite(t['cy'], 0)})'
                      : 'scale(${finite(t['x'], 1)},${finite(t['y'], 1)})',
                ),
              ].join(' ').trim();
            }
            final attrs = rawAttrs.entries
                .map((e) {
                  var resolved = value(e.value);
                  if (['fill', 'stroke'].contains(e.key) &&
                      colors.containsKey(resolved)) {
                    resolved = colors[resolved];
                  }
                  if (e.key == 'fill' && '$resolved'.startsWith('gradient:')) {
                    resolved = 'url(#$prefix-${('$resolved').substring(9)})';
                  }
                  if (e.key == 'clipId') {
                    return 'clip-path="url(#$prefix-clip-${escape(resolved)})"';
                  }
                  return '${const {'strokeWidth': 'stroke-width', 'strokeDasharray': 'stroke-dasharray', 'strokeDashoffset': 'stroke-dashoffset', 'strokeLinecap': 'stroke-linecap', 'strokeLinejoin': 'stroke-linejoin', 'fontSize': 'font-size', 'fontWeight': 'font-weight', 'fillOpacity': 'fill-opacity', 'strokeOpacity': 'stroke-opacity', 'fillRule': 'fill-rule', 'textAnchor': 'text-anchor'}[e.key] ?? e.key}="${escape(resolved)}"';
                })
                .join(' ');
            return '<$tag $attrs>${type == 'text' ? escape(value(n['text'])) : scene(n['children'] ?? [], depth + 1, locals)}</$tag>';
          }).join();
        }
        final defs =
            '<defs>${(p['gradients'] as List? ?? []).map((g) => '<linearGradient id="$prefix-${escape(g['id'])}">${(g['stops'] as List).map((s) => '<stop offset="${s['offset']}" stop-color="${escape(colors[s['color']] ?? s['color'])}"/>').join()}</linearGradient>').join()}${(p['clips'] as List? ?? []).map((clip) => '<clipPath id="$prefix-clip-${escape(clip['id'])}"><rect x="${clip['x']}" y="${clip['y']}" width="${clip['width']}" height="${clip['height']}"/></clipPath>').join()}</defs>';
        final svg =
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(p['viewBox'] as List).join(' ')}">$defs${scene(p['nodes'], 0)}</svg>';
        return column([
          text(p['title']),
          SizedBox(
            height: 320,
            child: InteractiveViewer(
              minScale: 1,
              maxScale: 3,
              child: SvgPicture.string(
                svg,
                height: 320,
                semanticsLabel: p['description'],
              ),
            ),
          ),
          ...sceneActions,
          text(p['description']),
        ]);
      case 'RouteMap':
        return column([
          text('${p['title']} — approximate schematic'),
          CustomPaint(
            size: const Size(double.infinity, 260),
            painter: _VisualPainter(
              points: p['points'],
              color: Theme.of(context).colorScheme.primary,
              route: true,
            ),
          ),
          for (final x in p['points']) text(x['label']),
          if (p['verifyAction'] != null)
            button(
              'Verify locations',
              () => runtime.dispatch(
                widget.sid,
                widget.node['id'],
                Map<String, dynamic>.from(p['verifyAction']),
                widget.scope,
              ),
            ),
        ]);
      case 'Plot':
        final values = p['values'] as List;
        final points = [
          for (var i = 0; i < values.length; i++)
            {
              'x': values[i] is num
                  ? (p['domain'] is List
                        ? p['domain'][0] +
                              i *
                                  (p['domain'][1] - p['domain'][0]) /
                                  math.max(1, values.length - 1)
                        : i)
                  : values[i][p['xKey']],
              'y': values[i] is num ? values[i] : values[i][p['yKey']],
            },
        ];
        return column([
          text(p['title']),
          CustomPaint(
            size: const Size(double.infinity, 240),
            painter: _VisualPainter(
              points: points,
              color: Theme.of(context).colorScheme.primary,
              kind: p['kind'],
            ),
          ),
          text('${p['xUnit'] ?? ''} / ${p['yUnit'] ?? ''}'),
          ExpansionTile(
            title: const Text('View plot data'),
            children: [text(jsonEncode(points))],
          ),
        ]);
      default:
        return const SizedBox.shrink();
    }
  }
}

class _VisualPainter extends CustomPainter {
  final List points;
  final Color color;
  final bool route;
  final String kind;
  _VisualPainter({
    required this.points,
    required this.color,
    this.route = false,
    this.kind = "line",
  });
  @override
  void paint(Canvas canvas, Size size) {
    if (points.isEmpty) return;
    final xs = points.map((v) => (v['x'] as num).toDouble()),
        ys = points.map((v) => (v['y'] as num).toDouble());
    final xmin = xs.reduce((a, b) => a < b ? a : b),
        xmax = xs.reduce((a, b) => a > b ? a : b),
        ymin = ys.reduce((a, b) => a < b ? a : b),
        ymax = ys.reduce((a, b) => a > b ? a : b);
    final path = Path();
    for (var i = 0; i < points.length; i++) {
      final x =
          20 +
          ((points[i]['x'] as num) - xmin) /
              (xmax - xmin == 0 ? 1 : xmax - xmin) *
              (size.width - 40);
      final y =
          size.height -
          20 -
          ((points[i]['y'] as num) - ymin) /
              (ymax - ymin == 0 ? 1 : ymax - ymin) *
              (size.height - 40);
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
      if (route || kind == "scatter") {
        canvas.drawCircle(Offset(x, y), route ? 5 : 3, Paint()..color = color);
      }
      if (kind == "histogram") {
        canvas.drawRect(
          Rect.fromLTWH(
            x,
            y,
            (size.width - 40) / points.length,
            ((size.height - 20) - y).abs(),
          ),
          Paint()..color = color,
        );
      }
    }
    if (kind == "area") {
      path.lineTo(size.width - 20, size.height - 20);
      path.lineTo(20, size.height - 20);
      path.close();
      canvas.drawPath(path, Paint()..color = color.withValues(alpha: .2));
    }
    if (kind != "scatter" && kind != "histogram") {
      canvas.drawPath(
        path,
        Paint()
          ..color = color
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _VisualPainter old) =>
      old.points != points || old.color != color;
}
