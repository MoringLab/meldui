import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_math_fork/flutter_math.dart';
import 'package:markdown/markdown.dart' as md;
import 'content.dart';
import 'renderer.dart';

/// Formatting is parsed into native widgets; raw HTML and remote image loaders are disabled.
Widget safeMarkdown(BuildContext context, String text, bool streaming) {
  if (text.length > 65536) {
    return const Text('Markdown is too large to display.');
  }
  final host = UIProvider.of(context).content;
  // Strip formatting tags outside code fences. Code examples remain literal data.
  final pieces = text.split('```');
  for (var i = 0; i < pieces.length; i += 2) {
    pieces[i] = pieces[i].replaceAll(RegExp(r'<[^>]*>'), '');
  }
  return MarkdownBody(
    data: pieces.join('```'),
    extensionSet: md.ExtensionSet.gitHubFlavored,
    selectable: true,
    inlineSyntaxes: [_InlineMath()],
    blockSyntaxes: [_BlockMath()],
    builders: {'engine-math': _Math()},
    imageBuilder: (uri, title, alt) =>
        uri.scheme == 'attachment' &&
            RegExp(r'^[A-Za-z0-9._:-]{1,128}$').hasMatch(uri.path)
        ? AttachmentMedia(id: uri.path, alt: alt)
        : Text(alt ?? 'Image unavailable'),
    onTapLink: (label, href, title) {
      if (href != null) {
        host?.followLink(href).catchError((_) {
          host.onDiagnostic?.call('LINK_BLOCKED', 'external');
        });
      }
    },
    styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
      tableBorder: TableBorder.all(color: Theme.of(context).dividerColor),
    ),
  );
}

class _InlineMath extends md.InlineSyntax {
  _InlineMath() : super(r'\$([^$\n]+)\$');
  @override
  bool onMatch(md.InlineParser parser, Match match) {
    parser.addNode(md.Element.text('engine-math', match[1]!));
    return true;
  }
}

class _BlockMath extends md.BlockSyntax {
  @override
  RegExp get pattern => RegExp(r'^\$\$\s*$');
  @override
  md.Node? parse(md.BlockParser parser) {
    parser.advance();
    final lines = <String>[];
    while (!parser.isDone &&
        !pattern.hasMatch(parser.current.content) &&
        lines.length < 100) {
      lines.add(parser.current.content);
      parser.advance();
    }
    if (!parser.isDone && pattern.hasMatch(parser.current.content)) {
      parser.advance();
    }
    return md.Element.text('engine-math', lines.join('\n'));
  }
}

class _Math extends MarkdownElementBuilder {
  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) => element.textContent.length > 2000
      ? Text(element.textContent)
      : SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Math.tex(
            element.textContent,
            textStyle: preferredStyle,
            onErrorFallback: (_) => Text(element.textContent),
          ),
        );
}
