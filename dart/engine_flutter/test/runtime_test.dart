import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:engine_flutter/engine_flutter.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final schema =
      jsonDecode(File('assets/catalog.json').readAsStringSync()) as JsonMap;
  final fixtures =
      jsonDecode(File('test/fixtures/cases.json').readAsStringSync()) as List;
  for (final fixture in fixtures) {
    test('${fixture['id']}: A2UI state and expression parity', () async {
      final runtime = await UIRuntime.create(schema: schema);
      for (final message in fixture['messages'] as List) {
        runtime.accept(message);
      }
      runtime.finish();
      expect(runtime.diagnostics, isEmpty);
      for (final component in runtime.surface('main')!.componentsModel.all) {
        expect(
          runtime.node('main', component.id)['error'],
          isNull,
          reason: component.id,
        );
      }
      for (final step in fixture['interactions'] as List) {
        runtime.setValue('main', step['path'] as String, step['value']);
        expect(
          runtime.node('main', step['node'] as String)['props'][step['prop']],
          step['expected'],
        );
      }
      runtime.dispose();
    });
  }
  for (final kitId in ['neutral', 'editorial']) {
    final kit = UIKit(
      jsonDecode(File('assets/kit-$kitId.json').readAsStringSync()) as JsonMap,
    );
    for (final fixture in fixtures) {
      testWidgets('$kitId/${fixture['id']}: narrow native rendering', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final runtime = await UIRuntime.create(schema: schema);
        for (final message in fixture['messages'] as List) {
          runtime.accept(message);
        }
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: UIProvider(
                  runtime: runtime,
                  kit: kit,
                  child: const UISurface(),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        runtime.dispose();
      });
    }
  }
  test('explicit null, deletion, and confirmed model conflict', () async {
    final runtime = await UIRuntime.create(schema: schema);
    for (final message in fixtures.first['messages'] as List) {
      runtime.accept(message);
    }
    runtime.setValue('main', '/nullable', null);
    expect((runtime.read('main', '/') as Map).containsKey('nullable'), true);
    runtime.beginRun('main');
    runtime.accept({
      'version': 'v0.9',
      'updateDataModel': {
        'surfaceId': 'main',
        'path': '/nullable',
        'value': 42,
      },
    });
    expect(runtime.read('main', '/nullable'), null);
    expect(runtime.getPendingWrites('main'), hasLength(1));
    runtime.resolveConflict('main', '/nullable', 'accept-model');
    expect(runtime.read('main', '/nullable'), 42);
    runtime.accept({
      'version': 'v0.9',
      'updateDataModel': {'surfaceId': 'main', 'path': '/nullable'},
    });
    expect((runtime.read('main', '/') as Map).containsKey('nullable'), false);
    expect(
      evaluateExpression({
        'op': 'format',
        'args': [
          '{0}',
          {'ref': '/object'},
        ],
      }, (_) => {'x': 1}),
      '{"x":1}',
    );
    runtime.dispose();
  });
  test('host catalog and component registration', () async {
    final custom = jsonDecode(jsonEncode(schema)) as JsonMap;
    custom['catalogId'] = 'urn:host:custom';
    custom[r'$id'] = 'urn:host:custom';
    final runtime = await UIRuntime.create(schema: custom);
    runtime.accept({
      'version': 'v0.9',
      'createSurface': {'surfaceId': 'main', 'catalogId': 'urn:host:custom'},
    });
    runtime.accept({
      'version': 'v0.9',
      'updateComponents': {
        'surfaceId': 'main',
        'components': [
          {'id': 'root', 'component': 'Text', 'text': 'host'},
        ],
      },
    });
    expect(runtime.diagnostics, isEmpty);
    expect(runtime.node('main', 'root')['props']['text'], 'host');
    runtime.dispose();
  });
  test('lazy expression, limits and prototype paths', () {
    expect(
      evaluateExpression({
        'op': 'if',
        'args': [
          true,
          42,
          {
            'op': 'div',
            'args': [1, 0],
          },
        ],
      }, (_) => 0),
      42,
    );
    expect(
      () => evaluateExpression({
        'op': 'div',
        'args': [1, 0],
      }, (_) => 0),
      throwsStateError,
    );
    expect(() => resolvePath('/__proto__/x'), throwsStateError);
    expect(
      () => evaluateExpression({
        'op': 'array',
        'args': List.filled(300, 1),
      }, (_) => 0),
      throwsStateError,
    );
  });
  test('stream chunk boundaries and local edit protection', () async {
    final runtime = await UIRuntime.create(schema: schema);
    final source = utf8.encode(
      (fixtures.first['messages'] as List).map(jsonEncode).join('\r\n'),
    );
    await runtime.consume(Stream.fromIterable(source.map((byte) => [byte])));
    expect(runtime.diagnostics, isEmpty);
    runtime.setValue('main', '/a', 123);
    runtime.accept({
      'version': 'v0.9',
      'updateDataModel': {'surfaceId': 'main', 'path': '/a', 'value': 999},
    });
    expect(runtime.read('main', '/a'), 123);
    expect(runtime.diagnostics.last['code'], 'LOCAL_EDIT_CONFLICT');
    runtime.dispose();
  });
  test('malformed UTF-8 retains the last valid surface', () async {
    final runtime = await UIRuntime.create(schema: schema);
    final messages = utf8.encode(
      '${(fixtures.first['messages'] as List).map(jsonEncode).join('\n')}\n',
    );
    await runtime.consume(
      Stream.fromIterable([
        messages,
        [0xff],
      ]),
    );
    expect(runtime.surfaceIds, ['main']);
    expect(runtime.diagnostics.last['code'], 'INVALID_UTF8');
    expect(runtime.node('main', 'root')['component'], 'Column');
    runtime.dispose();
  });
  test(
    'rejected batches isolate bad nodes and preserve the previous graph',
    () async {
      final runtime = await UIRuntime.create(schema: schema);
      runtime.accept({
        'version': 'v0.9',
        'createSurface': {'surfaceId': 'main', 'catalogId': catalogId},
      });
      runtime.accept({
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 'main',
          'components': [
            {
              'id': 'root',
              'component': 'Column',
              'children': ['child'],
            },
            {'id': 'child', 'component': 'Text', 'text': 'ready'},
            {'id': 'bad', 'component': 'Executable'},
          ],
        },
      });
      expect(runtime.node('main', 'child')['props']['text'], 'ready');
      expect(runtime.node('main', 'bad')['error'], 'INVALID_COMPONENT');
      runtime.accept({
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 'main',
          'components': [
            {
              'id': 'child',
              'component': 'Column',
              'children': ['root'],
            },
          ],
        },
      });
      expect(runtime.node('main', 'child')['component'], 'Text');
      runtime.dispose();
    },
  );
}
