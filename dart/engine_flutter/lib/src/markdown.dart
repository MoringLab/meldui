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
  return MarkdownBody(
    data: sanitizeMarkdownHtml(
      text,
      formattingHtml: host?.formattingHtml ?? false,
    ),
    extensionSet: md.ExtensionSet.gitHubFlavored,
    selectable: true,
    syntaxHighlighter: _CodeHighlighter(Theme.of(context).colorScheme),
    inlineSyntaxes: [
      if (host?.formattingHtml == true) _FormattingTags(),
      _InlineMath(),
    ],
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

/// Attribute-free formatting only; fences and inline code remain literal.
String sanitizeMarkdownHtml(String text, {bool formattingHtml = false}) {
  if (text.length > 65536) throw StateError('MARKDOWN_LIMIT');
  String? fence;
  String clean(String value) => value.replaceAllMapped(
    RegExp(r'<[^>]*>'),
    (m) =>
        formattingHtml &&
            RegExp(
              r'^</?(strong|b|em|i|s|del|code)>$',
              caseSensitive: false,
            ).hasMatch(m[0]!)
        ? m[0]!
        : '',
  );
  return text
      .split('\n')
      .map((line) {
        final marker = RegExp(r'^\s{0,3}(`{3,}|~{3,})').firstMatch(line);
        if (fence != null) {
          if (marker != null &&
              marker[1]![0] == fence![0] &&
              marker[1]!.length >= fence!.length &&
              line.substring(marker.end).trim().isEmpty) {
            fence = null;
          }
          return line;
        }
        if (marker != null) {
          fence = marker[1];
          return line;
        }
        var cursor = 0;
        final output = StringBuffer();
        for (final code in RegExp(r'(`+)[^`]*\1').allMatches(line)) {
          output.write(clean(line.substring(cursor, code.start)));
          output.write(code[0]);
          cursor = code.end;
        }
        output.write(clean(line.substring(cursor)));
        return output.toString();
      })
      .join('\n');
}

class _FormattingTags extends md.InlineSyntax {
  _FormattingTags()
    : super(
        r'<(strong|b|em|i|s|del|code)>([^<>\n]*)</\1>',
        caseSensitive: false,
      );
  @override
  bool onMatch(md.InlineParser parser, Match match) {
    const tags = {
      'b': 'strong',
      'strong': 'strong',
      'i': 'em',
      'em': 'em',
      's': 'del',
      'del': 'del',
      'code': 'code',
    };
    parser.addNode(md.Element.text(tags[match[1]!.toLowerCase()]!, match[2]!));
    return true;
  }
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

class _CodeHighlighter extends SyntaxHighlighter {
  final ColorScheme colors;
  _CodeHighlighter(this.colors);
  @override
  TextSpan format(String source) {
    if (source.length > 14000) {
      return TextSpan(
        text: source,
        style: TextStyle(color: colors.onSurface, fontFamily: 'monospace'),
      );
    }
    final tokens = RegExp(
      r"//[^\n]*|#[^\n]*|\b(?:const|let|var|function|return|if|else|class|import|from|def|for|while|true|false|null)\b|\b[0-9]+(?:\.[0-9]+)?\b",
    ).allMatches(source);
    final children = <TextSpan>[];
    var last = 0, count = 0;
    for (final match in tokens) {
      if (++count > 2000) break;
      children.add(TextSpan(text: source.substring(last, match.start)));
      final value = match.group(0)!;
      children.add(
        TextSpan(
          text: value,
          style: TextStyle(
            color: value.startsWith('//') || value.startsWith('#')
                ? colors.onSurfaceVariant
                : colors.primary,
            fontWeight: value.startsWith('//') || value.startsWith('#')
                ? FontWeight.normal
                : FontWeight.w600,
          ),
        ),
      );
      last = match.end;
    }
    children.add(TextSpan(text: source.substring(last)));
    return TextSpan(
      style: TextStyle(color: colors.onSurface, fontFamily: 'monospace'),
      children: children,
    );
  }
}
