import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:engine_flutter/engine_flutter.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final schema = jsonDecode(File('../../schemas/catalog.json').readAsStringSync()) as JsonMap;
  final fixtures = jsonDecode(File('../../fixtures/cases.json').readAsStringSync()) as List;
  for (final fixture in fixtures) {
    test('${fixture['id']}: A2UI state and expression parity', () async {
      final runtime = await UIRuntime.create(schema: schema);
      for (final message in fixture['messages'] as List) { runtime.accept(message); }
      runtime.finish();
      expect(runtime.diagnostics, isEmpty);
      for (final component in runtime.surface('main')!.componentsModel.all) { expect(runtime.node('main', component.id)['error'], isNull, reason: component.id); }
      for (final step in fixture['interactions'] as List) {
        runtime.setValue('main', step['path'] as String, step['value']);
        expect(runtime.node('main', step['node'] as String)['props'][step['prop']], step['expected']);
      }
      runtime.dispose();
    });
  }
  for (final kitId in ['neutral', 'editorial']) {
    final kit = UIKit(jsonDecode(File('../../schemas/kit-$kitId.json').readAsStringSync()) as JsonMap);
    for (final fixture in fixtures) {
      testWidgets('$kitId/${fixture['id']}: narrow native rendering', (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final runtime = await UIRuntime.create(schema: schema);
        for (final message in fixture['messages'] as List) { runtime.accept(message); }
        await tester.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(child: UIProvider(runtime: runtime, kit: kit, child: const UISurface())))));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        runtime.dispose();
      });
    }
  }
  test('lazy expression, limits and prototype paths', () {
    expect(evaluateExpression({'op': 'if', 'args': [true, 42, {'op': 'div', 'args': [1, 0]}]}, (_) => 0), 42);
    expect(() => evaluateExpression({'op': 'div', 'args': [1, 0]}, (_) => 0), throwsStateError);
    expect(() => resolvePath('/__proto__/x'), throwsStateError);
    expect(() => evaluateExpression({'op': 'array', 'args': List.filled(300, 1)}, (_) => 0), throwsStateError);
  });
  test('stream chunk boundaries and local edit protection', () async {
    final runtime = await UIRuntime.create(schema: schema);
    final source = utf8.encode((fixtures.first['messages'] as List).map(jsonEncode).join('\r\n'));
    await runtime.consume(Stream.fromIterable(source.map((byte) => [byte])));
    expect(runtime.diagnostics, isEmpty);
    runtime.setValue('main', '/a', 123);
    runtime.accept({'version': 'v0.9', 'updateDataModel': {'surfaceId': 'main', 'path': '/a', 'value': 999}});
    expect(runtime.read('main', '/a'), 123);
    expect(runtime.diagnostics.last['code'], 'LOCAL_EDIT_CONFLICT');
    runtime.dispose();
  });
}
