import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:engine_flutter/engine_flutter.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final schema =
      jsonDecode(File("assets/catalog.json").readAsStringSync()) as JsonMap;
  final kit = UIKit(
    jsonDecode(File("assets/kit-neutral.json").readAsStringSync()) as JsonMap,
  );
  final cases =
      jsonDecode(File('test/fixtures/service.json').readAsStringSync()) as List;
  for (final fixture in cases) {
    if (fixture['id'] == 'media-collection') continue;
    testWidgets('service ${fixture['id']} binds in a narrow host', (
      tester,
    ) async {
      final runtime = await UIRuntime.create(schema: schema);
      final session = AnswerSession(runtime);
      session.push(fixture['wire'] as String);
      session.end();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: SizedBox(
                width: 320,
                child: UIProvider(
                  runtime: runtime,
                  kit: kit,
                  child: AnswerView(session: session),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(
        runtime.diagnostics.where((d) => d['severity'] == 'error'),
        isEmpty,
      );
      if (fixture['id'] == 'purchase') {
        runtime.setValue('main', '/budget', 100000);
        await tester.pump();
        expect(runtime.node('main', 'count')['props']['value'], 1);
      }
      await tester.pumpWidget(const SizedBox());
      runtime.dispose();
    });
  }
  testWidgets('registered custom components use the generated shared catalog', (
    tester,
  ) async {
    final schema = Map<String, dynamic>.from(
      jsonDecode(File('test/fixtures/custom-catalog.json').readAsStringSync())
          as Map,
    );
    final fixture =
        jsonDecode(File('test/fixtures/custom.json').readAsStringSync()) as Map;
    final runtime = await UIRuntime.create(schema: schema);
    final session = AnswerSession(runtime);
    for (final message in fixture['messages']) {
      session.push('${jsonEncode(message)}\n');
    }
    session.end();
    expect(runtime.node('main', 'inspect')['props']['title'], 'Fork');
    runtime.setValue('main', '/voltage', 18);
    expect(runtime.read('main', '/voltage'), 18);
    expect(runtime.diagnostics.where((d) => d['severity'] == 'error'), isEmpty);
    runtime.dispose();
  });
  test(
    'revisioned updates preserve inputs and reject invalid replacements',
    () async {
      final runtime = await UIRuntime.create(schema: schema);
      final session = AnswerSession(runtime);
      session.push(cases.first['wire'] as String);
      session.end();
      final block = session.blocks.whereType<SurfaceBlock>().first;
      runtime.setValue('main', '/budget', 100000);
      await expectLater(
        session.updateArtifact(block.id, 1, messages: []),
        throwsStateError,
      );
      await expectLater(
        session.updateArtifact(
          block.id,
          0,
          messages: [
            {
              'version': 'v0.9',
              'updateComponents': {
                'surfaceId': 'main',
                'components': [
                  {'id': 'root', 'component': 'Nope'},
                ],
              },
            },
          ],
        ),
        throwsStateError,
      );
      expect(runtime.read('main', '/budget'), 100000);
      await session.updateArtifact(
        block.id,
        0,
        messages: [
          {
            'version': 'v0.9',
            'updateDataModel': {
              'surfaceId': 'main',
              'path': '/budget',
              'value': 200000,
            },
          },
        ],
      );
      expect(runtime.read('main', '/budget'), 100000);
      expect(session.artifactRevision(block.id), 1);
      final restored = AnswerSession.restore(
        session.serialize(),
        await UIRuntime.create(schema: schema),
      );
      expect(restored.artifactRevision(block.id), 1);
      restored.runtime.dispose();
      runtime.dispose();
    },
  );
}
