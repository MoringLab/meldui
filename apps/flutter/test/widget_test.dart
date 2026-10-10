import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:engine_lab/main.dart';

void main() {
  testWidgets('calculator input survives a kit switch', (tester) async {
    await tester.pumpWidget(const EngineLab());
    final state = tester.state<EngineLabState>(find.byType(EngineLab));
    for (var i = 0; i < 50 && state.runtime == null; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(state.runtime, isNotNull);
    await tester.pumpAndSettle();
    expect(find.text('Engine'), findsWidgets);
    expect(tester.takeException(), isNull);
    tester.widget<Slider>(find.byType(Slider).last).onChanged!(7);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Editorial'));
    await tester.pumpAndSettle();
    expect(state.kitId, 'editorial');
    expect(find.text('12000'), findsOneWidget);
    // The brand kit renders the host's Card; the edited value and result must survive the swap.
    await tester.tap(find.text('Brand'));
    await tester.pumpAndSettle();
    expect(state.kitId, 'brand');
    expect(find.byKey(const ValueKey('brand-card')), findsOneWidget);
    expect(find.text('12000'), findsOneWidget);
    expect(state.runtime!.read('main', '/b'), 7);
    await tester.tap(find.text('Neutral'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Editorial'));
    await tester.pumpAndSettle();
    expect(state.runtime!.read('main', '/b'), 7);
    expect(tester.takeException(), isNull);
    await tester.runAsync(() => state.replay('form', animate: false));
    await tester.pumpAndSettle();
    final name = find.descendant(
      of: find.byKey(const ValueKey<String>('_name')),
      matching: find.byType(TextField),
    );
    expect(name, findsOneWidget);
    await tester.ensureVisible(name);
    await tester.enterText(name, '루이');
    await tester.pumpAndSettle();
    expect(state.runtime!.read('main', '/name'), '루이');
    // editorial → brand: the brand kit swaps in host Button/Card widgets; state must survive.
    await tester.tap(find.text('Brand'));
    await tester.pumpAndSettle();
    expect(state.kitId, 'brand');
    expect(state.runtime!.read('main', '/name'), '루이');
    await tester.tap(find.text('Neutral'));
    await tester.pumpAndSettle();
    expect(state.runtime!.read('main', '/name'), '루이');
  });
}
