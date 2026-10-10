import 'dart:convert';
import 'dart:ui' show FrameTiming;
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
    // The app bar button names the NEXT kit in the cycle neutral → editorial → brand.
    const next = {'neutral': 'Editorial', 'editorial': 'Brand', 'brand': 'Neutral'};
    for (final kit in ['neutral', 'editorial', 'brand']) {
      for (var i = 0; i < 3 && state.kitId != kit; i++) {
        await tester.tap(find.text(next[state.kitId]!));
        await tester.pumpAndSettle();
      }
      for (final fixture in state.fixtures) {
        await state.replay(fixture['id'] as String, animate: false);
        await tester.pumpAndSettle();
        expect(
          state.runtime!.diagnostics.where((d) => d['severity'] == 'error'),
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
    // Two conditions, 130 samples each (10 warm-ups dropped, 120 kept):
    //  cold-tree: fresh runtime and freshly mounted tree for every sample
    //  warm:      one mounted tree and runtime; each sample deletes then recreates the surface
    const samples = 130, drop = 10;
    final kit = state.kits['neutral']!;
    final frameTimings = <FrameTiming>[];
    void onTimings(List<FrameTiming> t) => frameTimings.addAll(t);
    WidgetsBinding.instance.addTimingsCallback(onTimings);
    JsonMap components() => {
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
    };
    Future<Map<String, double>> measure(UIRuntime runtime) async {
      final clock = Stopwatch()..start();
      runtime.accept(components());
      final acceptMs = clock.elapsedMicroseconds / 1000;
      await tester.pump();
      clock.stop();
      return {
        'total': clock.elapsedMicroseconds / 1000,
        'acceptMs': acceptMs,
        'pumpMs': clock.elapsedMicroseconds / 1000 - acceptMs,
      };
    }

    Map<String, dynamic> stat(List<double> values) {
      final sorted = [...values]..sort();
      double at(double q) =>
          sorted[(sorted.length * q).ceil().clamp(1, sorted.length) - 1];
      return {
        'samples': sorted.length,
        'min': sorted.first,
        'p50': at(.5),
        'p90': at(.9),
        'p95': at(.95),
        'p99': at(.99),
        'max': sorted.last,
        'mean': sorted.reduce((a, b) => a + b) / sorted.length,
        'timingsMs': sorted,
      };
    }

    Map<String, dynamic> summary(List<Map<String, double>> kept) => {
      ...stat([for (final k in kept) k['total']!]),
      'phases': {
        'acceptMs': {...stat([for (final k in kept) k['acceptMs']!])..remove('timingsMs')},
        'pumpMs': {...stat([for (final k in kept) k['pumpMs']!])..remove('timingsMs')},
      },
    };

    frameTimings.clear();
    final cold = <Map<String, double>>[];
    final createMs = <double>[];
    for (var run = 0; run < samples; run++) {
      final createClock = Stopwatch()..start();
      final runtime = await UIRuntime.create();
      if (run >= drop) createMs.add(createClock.elapsedMicroseconds / 1000);
      runtime.accept({
        'version': 'v0.9',
        'createSurface': {'surfaceId': 'main', 'catalogId': catalogId},
      });
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: UIProvider(runtime: runtime, kit: kit, child: const UISurface()),
            ),
          ),
        ),
      );
      final result = await measure(runtime);
      if (run >= drop) cold.add(result);
      await tester.pumpWidget(const SizedBox());
      runtime.dispose();
    }
    await tester.pump(const Duration(milliseconds: 500));
    final coldFrames = frameTimings.toList();
    frameTimings.clear();
    final warmRuntime = await UIRuntime.create();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: UIProvider(runtime: warmRuntime, kit: kit, child: const UISurface()),
          ),
        ),
      ),
    );
    final warm = <Map<String, double>>[];
    for (var run = 0; run < samples; run++) {
      if (warmRuntime.surface('main') != null) {
        warmRuntime.accept({'version': 'v0.9', 'deleteSurface': {'surfaceId': 'main'}});
      }
      await tester.pump();
      warmRuntime.accept({
        'version': 'v0.9',
        'createSurface': {'surfaceId': 'main', 'catalogId': catalogId},
      });
      await tester.pump();
      final result = await measure(warmRuntime);
      if (run >= drop) warm.add(result);
    }
    await tester.pump(const Duration(milliseconds: 500));
    final warmFrames = frameTimings.toList();
    WidgetsBinding.instance.removeTimingsCallback(onTimings);
    Map<String, dynamic> frames(List<FrameTiming> list) => list.isEmpty
        ? {'count': 0}
        : {
            'count': list.length,
            'buildMs': {...stat([for (final f in list) f.buildDuration.inMicroseconds / 1000])..remove('timingsMs')},
            'rasterMs': {...stat([for (final f in list) f.rasterDuration.inMicroseconds / 1000])..remove('timingsMs')},
            'totalMs': {...stat([for (final f in list) f.totalSpan.inMicroseconds / 1000])..remove('timingsMs')},
          };
    final report = {
      'platform': 'flutter',
      'mode': 'profile',
      'nodes': 100,
      'warmupDropped': drop,
      'cold': {
        ...summary(cold),
        // Runtime creation (incl. one-time processor warm-up) happens while the model is still
        // working; it is reported so the cost is moved, not hidden.
        'createMs': {...stat(createMs)..remove('timingsMs')},
        'frames': frames(coldFrames),
      },
      'warm': {...summary(warm), 'frames': frames(warmFrames)},
    };
    // Legacy fields (cold-tree, the original definition) so older readers keep working.
    final legacy = {
      ...report,
      'samples': (report['cold'] as Map)['samples'],
      'p95Ms': (report['cold'] as Map)['p95'],
      'timingsMs': (report['cold'] as Map)['timingsMs'],
    };
    IntegrationTestWidgetsFlutterBinding.instance.reportData = {
      'performance': legacy,
    };
    debugPrint('ENGINE_PERFORMANCE ${jsonEncode(legacy)}');
  });
}
