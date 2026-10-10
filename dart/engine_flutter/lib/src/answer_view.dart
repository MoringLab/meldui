import 'package:flutter/material.dart';
import 'answer.dart';
import 'renderer.dart';
import 'markdown.dart';
import 'content.dart';

/// Builds Markdown for one block. Hosts replace it to reuse their own (sanitizing) pipeline.
typedef MarkdownBuilder =
    Widget Function(BuildContext context, String text, bool streaming);
typedef MediaBuilder = Widget Function(BuildContext context, MediaBlock block);

class AnswerLabels {
  final String surface;
  final String reset;
  final String expand;
  final String close;
  final String viewAsText;
  final String viewAsInterface;
  final String incomplete;
  final String sandboxBlocked;
  const AnswerLabels({
    this.surface = 'Interactive content',
    this.reset = 'Reset',
    this.expand = 'Expand',
    this.close = 'Close',
    this.viewAsText = 'View as text',
    this.viewAsInterface = 'View interactive',
    this.incomplete = 'Part of this content could not be shown.',
    this.sandboxBlocked = 'Interactive content is not available here.',
  });
}

/// Minimal built-in renderer: paragraphs and fenced code as plain [Text] (never markup).
Widget plainMarkdown(BuildContext context, String text, bool streaming) {
  final parts = text.split(RegExp(r'\n```[^\n]*\n([\s\S]*?)(?:\n```|$)'));
  final fences = RegExp(
    r'\n```[^\n]*\n([\s\S]*?)(?:\n```|$)',
  ).allMatches(text).toList();
  final children = <Widget>[];
  for (var i = 0; i < parts.length; i++) {
    for (final paragraph in parts[i].split(RegExp(r'\n{2,}'))) {
      if (paragraph.trim().isNotEmpty) children.add(Text(paragraph));
    }
    if (i < fences.length) {
      children.add(
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border.all(color: Theme.of(context).dividerColor),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              fences[i].group(1) ?? '',
              style: const TextStyle(fontFamily: 'monospace', fontSize: 14),
            ),
          ),
        ),
      );
    }
  }
  return Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      for (final c in children)
        Padding(padding: const EdgeInsets.only(bottom: 10), child: c),
    ],
  );
}

/// Ordered Markdown, surface and media blocks for one answer. The host list owns scrolling.
class AnswerView extends StatelessWidget {
  final AnswerSession session;
  final MarkdownBuilder markdown;
  final MediaBuilder? mediaBuilder;
  final void Function(String surfaceId)? onExpand;
  final double? maxSurfaceHeight;
  final bool chrome;
  final AnswerLabels labels;
  const AnswerView({
    super.key,
    required this.session,
    this.markdown = safeMarkdown,
    this.mediaBuilder,
    this.onExpand,
    this.maxSurfaceHeight,
    this.chrome = true,
    this.labels = const AnswerLabels(),
  });

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: session,
      builder: (context, _) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final block in session.blocks)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: switch (block) {
                MarkdownBlock() => KeyedSubtree(
                  key: ValueKey('md-${block.id}'),
                  child: markdown(context, block.text, block.streaming),
                ),
                SurfaceBlock() => _SurfaceFrame(
                  key: ValueKey('surface-${block.id}'),
                  block: block,
                  session: session,
                  chrome: chrome,
                  labels: labels,
                  maxHeight:
                      maxSurfaceHeight ?? session.policy.maxSurfaceHeight,
                  onExpand: onExpand,
                ),
                MediaBlock() =>
                  mediaBuilder?.call(context, block) ??
                      MediaContent(
                        ids: block.attachmentIds,
                        layout: block.layout,
                        caption: block.caption,
                      ),
                SandboxBlock() => Semantics(
                  liveRegion: true,
                  child: Text('${labels.sandboxBlocked} ${block.fallbackText}'),
                ),
              },
            ),
        ],
      ),
    );
  }
}

class _SurfaceFrame extends StatefulWidget {
  final SurfaceBlock block;
  final AnswerSession session;
  final bool chrome;
  final AnswerLabels labels;
  final double? maxHeight;
  final void Function(String surfaceId)? onExpand;
  const _SurfaceFrame({
    super.key,
    required this.block,
    required this.session,
    required this.chrome,
    required this.labels,
    this.maxHeight,
    this.onExpand,
  });
  @override
  State<_SurfaceFrame> createState() => _SurfaceFrameState();
}

class _SurfaceFrameState extends State<_SurfaceFrame> {
  bool asText = false;

  void _expand() {
    if (widget.onExpand != null) {
      widget.onExpand!(widget.block.surfaceId);
      return;
    }
    final host = UIProvider.of(context);
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (route) => UIProvider(
          runtime: host.runtime,
          kit: host.kit,
          dark: host.dark,
          assets: host.assets,
          content: host.content,
          components: host.components,
          child: Scaffold(
            appBar: AppBar(
              title: Text(widget.block.title ?? widget.labels.surface),
              leading: IconButton(
                tooltip: widget.labels.close,
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.of(route).pop(),
              ),
            ),
            body: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: UISurface(surfaceId: widget.block.surfaceId),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final host = UIProvider.of(context);
    final colors = host.kit.colors(host.dark);
    final border = Color(
      int.parse(
        (colors['border'] as String).replaceFirst('#', 'ff'),
        radix: 16,
      ),
    );
    final muted = Color(
      int.parse((colors['muted'] as String).replaceFirst('#', 'ff'), radix: 16),
    );
    final labels = widget.labels;
    final block = widget.block;
    Widget body = asText
        ? SelectableText(block.fallbackText)
        : UISurface(surfaceId: block.surfaceId);
    if (widget.maxHeight != null) {
      body = ConstrainedBox(
        constraints: BoxConstraints(maxHeight: widget.maxHeight!),
        child: SingleChildScrollView(child: body),
      );
    }
    Widget action(
      String label,
      IconData icon,
      VoidCallback onPressed, {
      bool selected = false,
    }) => IconButton(
      tooltip: label,
      isSelected: selected,
      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
      icon: Icon(icon, size: 20, color: muted),
      onPressed: onPressed,
    );
    return Semantics(
      container: true,
      label: block.title ?? labels.surface,
      hint: block.fallbackText,
      child: Container(
        decoration: BoxDecoration(
          border: Border.all(color: border),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.chrome)
              Container(
                padding: const EdgeInsets.only(left: 14, right: 2),
                decoration: BoxDecoration(
                  border: Border(bottom: BorderSide(color: border)),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        block.title ?? labels.surface,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: muted, fontSize: 13),
                      ),
                    ),
                    action(
                      labels.reset,
                      Icons.restart_alt,
                      () => widget.session.reset(block.surfaceId),
                    ),
                    action(labels.expand, Icons.open_in_full, _expand),
                    action(
                      asText ? labels.viewAsInterface : labels.viewAsText,
                      asText ? Icons.dashboard_outlined : Icons.notes,
                      () => setState(() => asText = !asText),
                      selected: asText,
                    ),
                  ],
                ),
              ),
            Padding(padding: const EdgeInsets.all(16), child: body),
            if (block.status == 'error')
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
                child: Text(
                  labels.incomplete,
                  style: TextStyle(color: muted, fontSize: 13),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
