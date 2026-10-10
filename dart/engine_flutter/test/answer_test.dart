import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:engine_flutter/engine_flutter.dart';

List<String> slices(String text, int size) => [
  for (var i = 0; i < text.length; i += size)
    text.substring(i, (i + size).clamp(0, text.length)),
];

List<Map<String, dynamic>> merge(List<AnswerItem> items) {
  final out = <Map<String, dynamic>>[];
  for (final item in items) {
    if (item.kind == 'text') {
      if (out.isNotEmpty && out.last['kind'] == 'text') {
        out.last['text'] = (out.last['text'] as String) + item.text;
      } else {
        out.add({'kind': 'text', 'text': item.text});
      }
    } else if (item.kind == 'json') {
      out.add({'kind': 'json', 'value': item.value});
    } else {
      out.add({'kind': 'invalid', 'line': item.text});
    }
  }
  return out;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final schema =
      jsonDecode(File('assets/catalog.json').readAsStringSync()) as JsonMap;
  final vectors =
      jsonDecode(File('test/fixtures/vectors.json').readAsStringSync()) as Map;

  for (final v in vectors['decoder'] as List) {
    test('decoder ${v['name']} matches the TypeScript reference', () {
      for (final size in [1, 3, 11, 100000]) {
        final d = AnswerDecoder();
        final items = [
          for (final chunk in slices(v['text'] as String, size))
            ...d.push(chunk),
          ...d.finish(),
        ];
        expect(jsonEncode(merge(items)), jsonEncode(v['items']));
      }
    });
  }

  for (final v in vectors['session'] as List) {
    test('session ${v['name']} matches the TypeScript reference', () async {
      final runtime = await UIRuntime.create(schema: schema);
      final session = AnswerSession(
        runtime,
        policy: HostPolicy.fromJson(
          Map<String, dynamic>.from(v['policy'] as Map),
        ),
      );
      for (final chunk in slices(v['text'] as String, 9)) {
        session.push(chunk);
      }
      session.end();
      expect(session.blocks.map((b) => b.kind).toList(), v['blocks']);
      expect(runtime.surfaceIds, v['surfaces']);
      final codes = {
        for (final d in runtime.diagnostics) d['code'] as String,
      }.toList()..sort();
      expect(codes, (v['diagnosticCodes'] as List).cast<String>());
      expect(
        session.blocks.whereType<MarkdownBlock>().map((b) => b.text).toList(),
        v['markdown'],
      );
      expect(
        session.blocks
            .whereType<SurfaceBlock>()
            .map((b) => b.fallbackSource)
            .toList(),
        v['fallbackSources'],
      );
      runtime.dispose();
    });
  }

  test(
    'serialize, restore and migrate keep user edits and old history',
    () async {
      final cases =
          jsonDecode(File('test/fixtures/hybrid.json').readAsStringSync())
              as List;
      final calc = cases.firstWhere((c) => c['id'] == 'h-calc');
      final runtime = await UIRuntime.create(schema: schema);
      final session = AnswerSession(runtime)..push(calc['wire'] as String);
      session.end();
      runtime.setValue('main', '/b', 7);
      final stored = jsonDecode(jsonEncode(session.serialize()));
      final again = await UIRuntime.create(schema: schema);
      final restored = AnswerSession.restore(stored, again);
      expect(restored.blocks.map((b) => b.kind), [
        'markdown',
        'surface',
        'markdown',
      ]);
      expect(again.read('main', '/b'), 7);
      expect(restored.asText(), session.asText());

      final legacy =
          jsonDecode(File('test/fixtures/cases.json').readAsStringSync())
              as List;
      final messages = legacy.first['messages'] as List;
      for (final input in [
        messages,
        {'schema': 1, 'messages': messages},
        messages.map(jsonEncode).join('\n'),
      ]) {
        final rt = await UIRuntime.create(schema: schema);
        final s = AnswerSession.restore(input, rt);
        expect(s.blocks.map((b) => b.kind), ['surface']);
        expect(
          (s.blocks.first as SurfaceBlock).fallbackText,
          contains('함께 나누는 저녁'),
        );
      }
      expect(() => migrateSnapshot({'schema': 9}), throwsStateError);
      session.reset('main');
      expect(runtime.read('main', '/b'), 4);
    },
  );
}
