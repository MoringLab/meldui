import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:engine_flutter/engine_flutter.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final schema =
      jsonDecode(File('assets/catalog.json').readAsStringSync()) as JsonMap;
  final hybrid =
      jsonDecode(File('test/fixtures/hybrid.json').readAsStringSync()) as List;
  for (final kitId in ['neutral', 'editorial']) {
    final kit = UIKit(
      jsonDecode(File('assets/kit-$kitId.json').readAsStringSync()) as JsonMap,
    );
    for (final width in [320.0, 480.0, 720.0, 960.0]) {
      for (final fixture in hybrid) {
        testWidgets('$kitId/${fixture['id']} @ ${width.toInt()}: renders without layout errors', (
          tester,
        ) async {
          tester.view.physicalSize = Size(width, 1600);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final runtime = await UIRuntime.create(schema: schema);
          final session = AnswerSession(runtime)
            ..push(fixture['wire'] as String)
            ..end();
          await tester.pumpWidget(
            MaterialApp(
              home: Scaffold(
                body: SingleChildScrollView(
                  child: UIProvider(
                    runtime: runtime,
                    kit: kit,
                    child: AnswerView(session: session),
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(
            find.byType(Semantics),
            findsWidgets,
          );
          await tester.pumpWidget(const SizedBox());
          runtime.dispose();
        });
      }
    }
  }

  testWidgets('markdown-only policy renders zero surfaces', (tester) async {
    final runtime = await UIRuntime.create(schema: schema);
    final calc = hybrid.firstWhere((f) => f['id'] == 'h-calc');
    final session = AnswerSession(
      runtime,
      policy: const HostPolicy(mode: 'markdown-only'),
    )..push(calc['wire'] as String)..end();
    final kit = UIKit(
      jsonDecode(File('assets/kit-neutral.json').readAsStringSync()) as JsonMap,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: UIProvider(runtime: runtime, kit: kit, child: AnswerView(session: session)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(UISurface), findsNothing);
    expect(runtime.surfaceIds, isEmpty);
    runtime.dispose();
  });

  testWidgets('reset restores the model data after an edit; view-as-text shows fallback', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(480, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final runtime = await UIRuntime.create(schema: schema);
    final calc = hybrid.firstWhere((f) => f['id'] == 'h-calc');
    final session = AnswerSession(runtime)..push(calc['wire'] as String)..end();
    final kit = UIKit(
      jsonDecode(File('assets/kit-neutral.json').readAsStringSync()) as JsonMap,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: UIProvider(runtime: runtime, kit: kit, child: AnswerView(session: session)),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    runtime.setValue('main', '/b', 7);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Reset'));
    await tester.pumpAndSettle();
    expect(runtime.read('main', '/b'), 4);
    await tester.tap(find.byTooltip('View as text'));
    await tester.pumpAndSettle();
    expect(find.textContaining('84,000원'), findsWidgets);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    runtime.dispose();
  });
}
