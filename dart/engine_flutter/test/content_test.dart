import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:engine_flutter/engine_flutter.dart';

void main() {
  test(
    'formatting allowlist rejects attributes and preserves literal code',
    () {
      expect(sanitizeMarkdownHtml('<b>x</b>'), 'x');
      expect(
        sanitizeMarkdownHtml('<b>x</b>', formattingHtml: true),
        '<b>x</b>',
      );
      expect(
        sanitizeMarkdownHtml(
          '<b onclick="attack()">x</b>',
          formattingHtml: true,
        ),
        'x</b>',
      );
      const literal = '~~~html\n<b>example</b>\n~~~\n`<img src=x>`';
      expect(sanitizeMarkdownHtml(literal, formattingHtml: true), literal);
    },
  );

  final schema =
      jsonDecode(File('assets/catalog.json').readAsStringSync()) as JsonMap;
  final media =
      jsonDecode(File('test/fixtures/media.json').readAsStringSync()) as List;
  final xss =
      jsonDecode(File('test/fixtures/xss.json').readAsStringSync()) as List;
  final kit = UIKit(
    jsonDecode(File('assets/kit-neutral.json').readAsStringSync()) as JsonMap,
  );
  test(
    'resolver checks origins, types, unknown ids and expiry without media bytes',
    () async {
      final registry = AttachmentRegistry();
      registry.attach(id: 'photo', name: 'Photo', mime: 'image/png');
      var calls = 0;
      final host = ContentHost(
        attachments: registry,
        origins: {'https://media.example'},
        resolver: (id, purpose) async {
          calls++;
          return ResolvedAttachment(
            url: 'https://media.example/photo.png',
            mime: 'image/png',
            expiresAt: calls == 1
                ? DateTime.now().subtract(const Duration(seconds: 1))
                : null,
          );
        },
      );
      await host.resolve('photo');
      expect(calls, 2);
      await expectLater(host.resolve('unknown'), throwsStateError);
      expect(calls, 2);
      final blocked = ContentHost(
        attachments: registry,
        origins: {},
        resolver: (id, purpose) async => const ResolvedAttachment(
          url: 'https://evil.example/photo.png',
          mime: 'image/png',
        ),
      );
      await expectLater(blocked.resolve('photo'), throwsStateError);
    },
  );
  test(
    'model views redact region URLs and require separate text and vision consent',
    () {
      final registry = AttachmentRegistry();
      registry.attach(
        id: 'private',
        name: 'Private',
        mime: 'image/png',
        meta: {
          'url': 'https://host.example/photo?token=secret',
          'handle': 'opaque-secret',
          'description': 'Private description',
          'regions': [
            {
              'id': 'a',
              'label': 'https://host.example/secret?token=secret',
              'x': 0,
              'y': 0,
              'width': 1,
              'height': 1,
            },
          ],
        },
      );
      expect(jsonEncode(registry.views()), isNot(contains('secret')));
      expect(registry.views().single.containsKey('description'), isFalse);
      expect(registry.visionIds, isEmpty);
      registry.attach(
        id: 'consent',
        name: 'Consented',
        mime: 'image/png',
        modelText: true,
        modelVision: true,
        meta: {'description': 'Host supplied text'},
      );
      expect(registry.views().last['description'], 'Host supplied text');
      expect(registry.visionIds, ['consent']);
    },
  );
  test(
    'history redacts signed URLs in either scheme case without mutating live text',
    () async {
      final runtime = await UIRuntime.create(schema: schema);
      final session = AnswerSession(runtime)
        ..push('[link](HTTPS://host.example/report?signature=SECRET)');
      session.end();
      expect(jsonEncode(session.serialize()), isNot(contains('SECRET')));
      expect(session.asText(), contains('SECRET'));
      runtime.dispose();
    },
  );
  for (final fixture in media) {
    test(
      'media catalog ${fixture['id']} validates, isolates unknown IDs',
      () async {
        final runtime = await UIRuntime.create(schema: schema);
        for (final a in fixture['attachments'] as List) {
          runtime.attachments.attach(
            id: a['id'],
            name: a['name'],
            mime: a['mime'],
            meta: Map<String, dynamic>.from(a),
          );
        }
        for (final m in fixture['messages'] as List) {
          runtime.accept(m);
        }
        runtime.finish();
        expect(runtime.diagnostics, isEmpty);
        for (final component in runtime.surface('main')!.componentsModel.all) {
          expect(runtime.node('main', component.id)['error'], isNull);
        }
        runtime.accept({
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 'main',
            'components': [
              {
                'id': 'image',
                'component': 'Image',
                'attachmentId': 'unknown',
                'alt': 'bad',
              },
            ],
          },
        });
        expect(runtime.diagnostics, isNotEmpty);
        runtime.dispose();
      },
    );
  }
  testWidgets(
    'the complete media surface reads resolved component props and preserves Markdown',
    (tester) async {
      final fixture = media.first;
      final runtime = await UIRuntime.create(schema: schema);
      for (final a in fixture['attachments'] as List) {
        runtime.attachments.attach(
          id: a['id'],
          name: a['name'],
          mime: a['mime'],
          meta: Map<String, dynamic>.from(a),
        );
      }
      for (final message in fixture['messages'] as List) {
        runtime.accept(message);
      }
      final host = ContentHost(
        attachments: runtime.attachments,
        resolver: (id, purpose) async => throw StateError('HOST_BLOCKED'),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: UIProvider(
                runtime: runtime,
                kit: kit,
                content: host,
                child: const UISurface(surfaceId: 'main'),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(find.text('A hybrid answer'), findsOneWidget);
      expect(find.text('Host report'), findsWidgets);
      runtime.dispose();
    },
  );
  for (final item in xss) {
    testWidgets('native Markdown XSS ${item['id']} has no network loader', (
      tester,
    ) async {
      final runtime = await UIRuntime.create(schema: schema);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: UIProvider(
                runtime: runtime,
                kit: kit,
                child: Builder(
                  builder: (context) =>
                      safeMarkdown(context, item['payload'] as String, false),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(find.byType(Image), findsNothing);
      runtime.dispose();
    });
  }
  for (final width in [320.0, 480.0, 720.0, 960.0]) {
    testWidgets('GFM/math/code at $width without native layout errors', (
      tester,
    ) async {
      tester.view.physicalSize = Size(width, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final runtime = await UIRuntime.create(schema: schema);
      const source =
          '## Hello\n\n**bold** ~~strike~~ \$x^2\$\n\n| Key | Value |\n| --- | --- |\n| Owner | Host |\n\n- [x] Done\n\n```js\nconst x = 2;\n```';
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: UIProvider(
                runtime: runtime,
                kit: kit,
                child: Builder(
                  builder: (context) => safeMarkdown(context, source, false),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
      runtime.dispose();
    });
  }
}
