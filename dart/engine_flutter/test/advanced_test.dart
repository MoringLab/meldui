import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:engine_flutter/engine_flutter.dart';

void main() {
  final vectors =
      jsonDecode(File('test/fixtures/advanced-vectors.json').readAsStringSync())
          as List;
  void compare(dynamic actual, dynamic expected) {
    if (actual is num && expected is num) {
      expect(actual, closeTo(expected, 1e-9));
    } else if (actual is List && expected is List) {
      expect(actual.length, expected.length);
      for (var i = 0; i < actual.length; i++) {
        compare(actual[i], expected[i]);
      }
    } else {
      expect(actual, expected);
    }
  }

  for (final row in vectors) {
    test('advanced AST parity ${row['id']}', () {
      if (row['error'] != null) {
        expect(
          () => evaluateExpression(row['expr'], (_) => null),
          throwsA(predicate((e) => '$e'.contains(row['error']))),
        );
      } else {
        compare(evaluateExpression(row['expr'], (_) => null), row['expected']);
      }
    });
  }
}
