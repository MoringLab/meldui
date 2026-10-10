import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:engine_lab/main.dart';
import 'package:engine_flutter/engine_flutter.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('all fixtures, kit state and 100-node first frame on Android', (
    tester,
  ) async {
    await tester.pumpWidget(const EngineLab());
    await tester.pumpAndSettle();
    final state = tester.state<EngineLabState>(find.byType(EngineLab));
    await state.ready;
    for (final kit in ['neutral', 'editorial']) {
      if (state.kitId != kit) {
        await tester.tap(find.text(kit == 'neutral' ? 'Neutral' : 'Editorial'));
        await tester.pumpAndSettle();
      }
      for (final fixture in state.fixtures) {
        await state.replay(fixture['id'] as String, animate: false);
        await tester.pumpAndSettle();
        expect(
          state.runtime!.diagnostics,
          isEmpty,
          reason: '$kit/${fixture['id']}',
        );
        expect(tester.takeException(), isNull);
      }
    }
    await state.replay('form', animate: false);
    await tester.pumpAndSettle();
    final name = find.descendant(
      of: find.byKey(const ValueKey('_name')),
      matching: find.byType(TextField),
    );
    expect(name, findsOneWidget);
    await tester.ensureVisible(name);
    // IntegrationTest does not register the test text-input channel by default.
    // OS keyboard interaction is exercised separately by the Maestro flow.
    tester.testTextInput.register();
    await tester.enterText(name, '루이');
    await tester.pumpAndSettle();
    expect(state.runtime!.read('main', '/name'), '루이');
    await tester.tap(find.text('Neutral'));
    await tester.pumpAndSettle();
    expect(state.runtime!.read('main', '/name'), '루이');
    FocusManager.instance.primaryFocus?.unfocus();
    tester.testTextInput.unregister();
    final timings = <double>[];
    final kit = state.kits['neutral']!;
    for (var run = 0; run < 35; run++) {
      final runtime = await UIRuntime.create();
      runtime.accept({
        'version': 'v0.9',
        'createSurface': {'surfaceId': 'main', 'catalogId': catalogId},
      });
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
      final clock = Stopwatch()..start();
      runtime.accept({
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 'main',
          'components': [
            {
              'id': 'root',
              'component': 'Column',
              'children': [for (var i = 0; i < 99; i++) 'n$i'],
            },
            for (var i = 0; i < 99; i++)
              {'id': 'n$i', 'component': 'Text', 'text': '측정 $i'},
          ],
        },
      });
      await tester.pump();
      clock.stop();
      if (run >= 5) timings.add(clock.elapsedMicroseconds / 1000);
      await tester.pumpWidget(const SizedBox());
      runtime.dispose();
    }
    timings.sort();
    IntegrationTestWidgetsFlutterBinding.instance.reportData = {
      "performance": {
        "platform": "flutter",
        "nodes": 100,
        "samples": timings.length,
        "p95Ms": timings[(timings.length * .95).ceil() - 1],
      },
    };
    debugPrint(
      'ENGINE_PERFORMANCE ${jsonEncode({'platform': 'flutter', 'mode': 'profile', 'nodes': 100, 'samples': timings.length, 'p95Ms': timings[(timings.length * .95).ceil() - 1], 'timingsMs': timings})}',
    );
  });
}
