import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:engine_flutter/engine_flutter.dart';

void main() {
  test('SVG validation boundary', () async {
    final schema =
        jsonDecode(File('assets/catalog.json').readAsStringSync()) as JsonMap;
    final runtime = await UIRuntime.create(schema: schema);
    final fixtures =
        jsonDecode(File('test/fixtures/showcase.json').readAsStringSync())
            as List;
    final lines = (fixtures.first['wire'] as String).trim().split('\n');
    final visual =
        ((jsonDecode(lines.last)['updateComponents']['components']) as List)
            .firstWhere((c) => c['id'] == 'visual');
    runtime.processor
        .validatorFor(runtime.processor.catalogs.single)
        .validateComponent(Map<String, dynamic>.from(visual));
    runtime.dispose();
  });
}
