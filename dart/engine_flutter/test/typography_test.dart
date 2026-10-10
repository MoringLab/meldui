import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:engine_flutter/engine_flutter.dart';

void main() {
  final vectors =
      jsonDecode(File('test/fixtures/typography.json').readAsStringSync())
          as Map<String, dynamic>;
  for (final entry in vectors.entries) {
    final kit = UIKit(
      jsonDecode(File('assets/kit-${entry.key}.json').readAsStringSync())
          as JsonMap,
    );
    for (final os in ['ios', 'android']) {
      test('${entry.key}/$os typography matches the TypeScript reference', () {
        final want = entry.value[os] as Map<String, dynamic>;
        final got = kit.typography(ios: os == 'ios');
        final body = want['body'] as Map<String, dynamic>;
        final heading = want['heading'] as Map<String, dynamic>;
        expect(got.bodySize, (body['size'] as num).toDouble());
        expect(got.bodyWeight, body['weight']);
        expect(got.bodyLineHeight, (body['lineHeight'] as num).toDouble());
        expect(got.bodyFamily, body['nativeFamily']);
        expect(got.smallSize, (want['small']['size'] as num).toDouble());
        expect(got.headingWeight, heading['weight']);
        expect(
          got.headingSizes,
          (heading['sizes'] as List).map((e) => (e as num).toDouble()).toList(),
        );
        expect(
          got.headingLineHeights,
          (heading['lineHeights'] as List).map((e) => (e as num).toDouble()).toList(),
        );
        expect(got.headingFamily, heading['nativeFamily']);
      });
    }
  }
}
