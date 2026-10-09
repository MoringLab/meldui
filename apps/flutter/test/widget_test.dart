import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:engine_lab/main.dart';
void main() {
  testWidgets('calculator input survives a kit switch', (tester) async {
    await tester.pumpWidget(const EngineLab());
    final state = tester.state<EngineLabState>(find.byType(EngineLab));
    for (var i = 0; i < 50 && state.runtime == null; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(state.runtime, isNotNull);
    await tester.pumpAndSettle();
    expect(find.text('Engine'), findsWidgets);
    expect(tester.takeException(), isNull);
    state.runtime!.setValue('main', '/a', 7);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Editorial'));
    await tester.pumpAndSettle();
    expect(state.kitId, 'editorial');
    expect(state.runtime!.read('main', '/a'), 7);
    expect(tester.takeException(), isNull);
  });
}
