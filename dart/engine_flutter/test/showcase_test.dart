import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:engine_flutter/engine_flutter.dart';

void main() {
  final fixtures =
      jsonDecode(File('test/fixtures/showcase.json').readAsStringSync())
          as List;
  for (final kit in ['neutral', 'editorial', 'brand']) {
    for (final f in fixtures.where((f) => f['path'] == 'A')) {
      testWidgets('$kit ${f['id']} native learning and visual rendering', (
        tester,
      ) async {
        final runtime = await UIRuntime.create(
              schema:
                  jsonDecode(File('assets/catalog.json').readAsStringSync())
                      as JsonMap,
            ),
            skin = UIKit(
              jsonDecode(File('assets/kit-$kit.json').readAsStringSync())
                  as JsonMap,
            ),
            answer = AnswerSession(runtime);
        answer.push(f['wire']);
        answer.end();
        await tester.pumpWidget(
          MaterialApp(
            home: UIProvider(
              runtime: runtime,
              kit: skin,
              child: Scaffold(
                body: SingleChildScrollView(
                  child: SizedBox(
                    width: 320,
                    child: AnswerView(session: answer),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          runtime.diagnostics.where((d) => d['severity'] == 'error'),
          isEmpty,
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        runtime.dispose();
      });
    }
  }
  testWidgets(
    'part controls disclose actions and preserve independent input semantics',
    (tester) async {
      final runtime = await UIRuntime.create(
        schema:
            jsonDecode(File('assets/catalog.json').readAsStringSync())
                as JsonMap,
      );
      final kit = UIKit(
        jsonDecode(File('assets/kit-neutral.json').readAsStringSync())
            as JsonMap,
      );
      final answer = AnswerSession(runtime)
        ..push(fixtures.firstWhere((f) => f['id'] == '01')['wire'])
        ..end();
      await tester.pumpWidget(
        MaterialApp(
          home: UIProvider(
            runtime: runtime,
            kit: kit,
            child: Scaffold(
              body: SingleChildScrollView(child: AnswerView(session: answer)),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('앞바퀴'), findsNothing);
      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Semantics &&
              w.container &&
              w.explicitChildNodes &&
              w.properties.label == '자전거를 이루는 부품',
        ),
        findsWidgets,
      );
      await tester.ensureVisible(find.text('부품 선택'));
      await tester.tap(find.text('부품 선택'));
      await tester.pumpAndSettle();
      expect(find.text('앞바퀴'), findsOneWidget);
      tester.widget<Slider>(find.byType(Slider).first).onChanged!(80);
      await tester.pump();
      expect(runtime.read('main', '/a'), 80);
      await tester.pumpWidget(const SizedBox());
      runtime.dispose();
    },
  );
}
