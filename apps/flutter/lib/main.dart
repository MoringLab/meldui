import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:engine_flutter/engine_flutter.dart';
import 'brand.dart';

const server = String.fromEnvironment(
  'ENGINE_SERVER_URL',
  defaultValue: 'http://127.0.0.1:8787',
);

void main() {
  runApp(const EngineLab());
}

class EngineLab extends StatefulWidget {
  const EngineLab({super.key});
  @override
  State<EngineLab> createState() => EngineLabState();
}

class EngineLabState extends State<EngineLab> {
  List<dynamic> fixtures = [];
  List<dynamic> hybridFixtures = [];
  List<dynamic> mediaFixtures = [];
  ContentHost? content;
  AnswerSession? session;
  UIRuntime? get runtime => session?.runtime;
  bool scrollLocked = false;
  final Map<String, UIKit> kits = {};
  String kitId = 'neutral';
  String model = 'cx/gpt-5.6-sol-medium';
  String selected = 'calculator';
  String status = '예제를 준비하고 있습니다.';
  String? sessionId;
  bool dark = false, busy = false, inspector = false;
  int messages = 0, generation = 0;
  HttpClient? client;
  final prompt = TextEditingController();
  final scroll = ScrollController();
  List<String> diagnostics = [];
  late final Future<void> ready;
  @override
  void initState() {
    super.initState();
    ready = initialize();
  }

  Future<void> initialize() async {
    fixtures =
        jsonDecode(await rootBundle.loadString('assets/cases.json')) as List;
    hybridFixtures =
        jsonDecode(await rootBundle.loadString('assets/hybrid.json')) as List;
    mediaFixtures =
        jsonDecode(await rootBundle.loadString('assets/media.json')) as List;
    fixtures = [...fixtures, ...mediaFixtures];
    kits['neutral'] = await UIKit.load('neutral');
    kits['editorial'] = await UIKit.load('editorial');
    kits['brand'] = await UIKit.load('brand');
    await replay('calculator', animate: false);
  }

  void displaySession(AnswerSession next) {
    final previous = session;
    setState(() {
      session = next;
      content = _content(next.runtime);
    });
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => previous?.runtime.dispose(),
    );
  }

  ContentHost _content(UIRuntime owner) {
    final files = {
      'photo-a': 'coast.png',
      'photo-b': 'mountain.png',
      'video-a': 'sample.mp4',
      'audio-a': 'sample.wav',
      'file-a': 'report.pdf',
    };
    for (final a in mediaFixtures.first['attachments'] as List) {
      if (owner.attachments.get(a['id'] as String) == null) {
        owner.attachments.attach(
          id: a['id'] as String,
          name: a['name'] as String,
          mime: a['mime'] as String,
          meta: Map<String, dynamic>.from(a as Map),
        );
      }
    }
    return ContentHost(
      attachments: owner.attachments,
      origins: {Uri.parse(server).origin},
      schemes: const {'http'},
      resolver: (id, purpose) async => ResolvedAttachment(
        url: '$server/api/attachments/${files[id]}',
        mime: owner.attachments.get(id)!['mime'] as String,
      ),
      open: (id) async {
        if (mounted) setState(() => status = 'open:$id');
      },
      download: (id) async {
        if (mounted) setState(() => status = 'download:$id');
      },
    );
  }

  Future<AnswerSession> fresh({bool display = true}) async {
    final created = await UIRuntime.create(
      onAction: (action) {
        generate(
          '사용자가 ${action['name']} 작업을 요청했습니다. 현재 화면에 결과를 반영하세요.',
          action: action,
        );
      },
      clientActions: {
        'copyText': (args) =>
            Clipboard.setData(ClipboardData(text: displayValue(args['text']))),
      },
    );
    _content(created);
    final next = AnswerSession(created);
    if (!mounted) {
      created.dispose();
      return next;
    }
    if (!display) return next;
    displaySession(next);
    setState(() {
      diagnostics = [];
      messages = 0;
      sessionId = null;
    });
    return next;
  }

  Future<void> replay(String id, {bool animate = true}) async {
    client?.close(force: true);
    final run = ++generation;
    final next = await fresh();
    if (!mounted || run != generation) return;
    setState(() {
      selected = id;
      busy = false;
      status = '예제를 표시하고 있습니다.';
    });
    final hybrid = hybridFixtures.where((f) => f['id'] == id).firstOrNull;
    final fixture =
        fixtures.firstWhere((f) => f['id'] == id, orElse: () => fixtures.first)
            as Map;
    // Legacy fixtures replay as one JSON control line per message; hybrid ones as mixed text.
    final lines = hybrid != null
        ? (hybrid['wire'] as String).split('\n')
        : [
            jsonEncode({
              'engine': 'v1',
              'block': 'surface',
              'surfaceId': 'main',
              'fallbackText':
                  '${fixture['title']}. ${fixture['prompt'] ?? fixture['fallbackText']}',
            }),
            for (final m in fixture['messages'] as List) jsonEncode(m),
          ];
    for (final line in lines) {
      if (!mounted || run != generation) return;
      next.push('$line\n');
      setState(() {
        messages++;
      });
      if (animate) await Future<void>.delayed(const Duration(milliseconds: 25));
    }
    next.end();
    if (mounted && run == generation) {
      setState(() {
        status = '준비되었습니다. 입력값을 바꿔보세요.';
        diagnostics = next.runtime.diagnostics
            .map((d) => d['code'] as String)
            .toList();
      });
    }
    if (scroll.hasClients) scroll.jumpTo(0);
  }

  Future<void> generate(String text, {JsonMap? action}) async {
    if (text.trim().isEmpty) return;
    client?.close(force: true);
    final run = ++generation;
    final next = action != null ? session! : await fresh(display: false);
    var displayed = action != null;
    if (!mounted || run != generation) {
      if (!displayed) next.runtime.dispose();
      return;
    }
    if (action != null) next.beginTurn();
    next.runtime.beginRun('main');
    prompt.clear();
    setState(() {
      if (action == null) {
        sessionId = null;
        diagnostics = [];
        messages = 0;
      }
      busy = true;
      selected = '';
      status = '인터페이스를 만들고 있습니다.';
    });
    final activeClient = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);
    client = activeClient;
    try {
      const base = String.fromEnvironment(
        'ENGINE_SERVER_URL',
        defaultValue: 'http://127.0.0.1:8787',
      );
      final request = await activeClient.postUrl(Uri.parse('$base/api/ui'));
      request.headers.contentType = ContentType.json;
      request.write(
        jsonEncode({
          'prompt': text,
          'action': action,
          'model': model,
          'kitId': kitId,
          'platform': 'flutter',
          'format': 'hybrid',
          'sessionId': sessionId,
        }),
      );
      final response = await request.close();
      if (response.statusCode != 200) {
        throw StateError('서버 연결을 확인하세요 (${response.statusCode}).');
      }
      var bytes = 0;
      await for (final line
          in response.transform(utf8.decoder).transform(const LineSplitter())) {
        if (!mounted || run != generation) break;
        bytes += utf8.encode(line).length;
        if (bytes > 8 * 1024 * 1024 || utf8.encode(line).length > 300 * 1024) {
          throw StateError('STREAM_LIMIT');
        }
        if (line.trim().isEmpty) continue;
        final event = jsonDecode(line) as Map;
        if (event['type'] == 'session') {
          sessionId = event['sessionId'] as String;
        }
        if (event['type'] == 'text') {
          next.push(event['text'] as String);
          if (!displayed && next.blocks.isNotEmpty) {
            displaySession(next);
            displayed = true;
          }
          setState(() => messages++);
        }
        if (event['type'] == 'diagnostic') {
          setState(
            () => diagnostics.add(event['diagnostic']['code'] as String),
          );
        }
        if (event['type'] == 'repair') {
          next.beginTurn();
          setState(() => status = '일부 항목 수정 중 (${event['attempt']}/2)');
        }
        if (event['type'] == 'complete') {
          next.end();
          setState(
            () => status = event['status'] == 'completed'
                ? '완료되었습니다.'
                : '일부 항목을 완료하지 못했습니다.',
          );
        }
      }
    } catch (_) {
      if (mounted && run == generation) {
        setState(() => status = '연결을 확인하고 다시 시도하세요.');
      }
    } finally {
      if (!displayed) next.runtime.dispose();
      activeClient.close(force: true);
      if (mounted && run == generation) setState(() => busy = false);
    }
  }

  void cancel() {
    generation++;
    client?.close(force: true);
    session?.runtime.cancel();
    setState(() {
      busy = false;
      status = '생성을 중단했습니다.';
    });
  }

  @override
  void dispose() {
    generation++;
    client?.close(force: true);
    session?.runtime.dispose();
    prompt.dispose();
    scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final kit = kits[kitId];
    Color color(String key, Color fallback) => kit == null
        ? fallback
        : Color(
            int.parse(
              (kit.colors(dark)[key] as String).replaceFirst('#', 'ff'),
              radix: 16,
            ),
          );
    final background = color('background', const Color(0xfff4f6fa));
    final foreground = color('foreground', const Color(0xff192638));
    final accent = color('accent', const Color(0xff245aca));
    final theme = ThemeData(
      useMaterial3: true,
      brightness: dark ? Brightness.dark : Brightness.light,
      colorScheme: ColorScheme.fromSeed(
        seedColor: accent,
        brightness: dark ? Brightness.dark : Brightness.light,
        surface: color('surface', Colors.white),
      ),
      scaffoldBackgroundColor: background,
    );
    return MaterialApp(
      title: 'Engine Lab',
      debugShowCheckedModeBanner: false,
      theme: theme,
      home: Scaffold(
        appBar: AppBar(
          title: const Text('Engine'),
          backgroundColor: background,
          actions: [
            TextButton(
              onPressed: () => setState(
                () => kitId = kitId == 'neutral'
                    ? 'editorial'
                    : kitId == 'editorial'
                    ? 'brand'
                    : 'neutral',
              ),
              child: Text(
                kitId == 'neutral'
                    ? 'Editorial'
                    : kitId == 'editorial'
                    ? 'Brand'
                    : 'Neutral',
              ),
            ),
            IconButton(
              tooltip: dark ? '라이트 모드' : '다크 모드',
              onPressed: () => setState(() => dark = !dark),
              icon: Icon(
                dark ? Icons.light_mode_outlined : Icons.dark_mode_outlined,
              ),
            ),
          ],
        ),
        body: SafeArea(
          child: session == null || kit == null
              ? const Center(child: CircularProgressIndicator())
              : Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 18),
                      child: DropdownButton<String>(
                        key: const ValueKey('fixture-picker'),
                        value: selected,
                        isExpanded: true,
                        items: [
                          if (selected.isEmpty)
                            const DropdownMenuItem(
                              value: '',
                              child: Text('생성된 인터페이스'),
                            ),
                          for (final fixture in fixtures)
                            DropdownMenuItem(
                              value: fixture['id'] as String,
                              child: Text(
                                fixture['title'] as String,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          for (final fixture in hybridFixtures)
                            DropdownMenuItem(
                              value: fixture['id'] as String,
                              child: Text(
                                '섞어 보기 · ${fixture['title']}',
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                        ],
                        onChanged: (id) {
                          if (id != null && id.isNotEmpty) replay(id);
                        },
                      ),
                    ),
                    Expanded(
                      child: SingleChildScrollView(
                        controller: scroll,
                        physics: scrollLocked
                            ? const NeverScrollableScrollPhysics()
                            : null,
                        padding: const EdgeInsets.all(18),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            UIProvider(
                              runtime: runtime!,
                              kit: kit,
                              dark: dark,
                              components: brandComponents(kit, dark),
                              content: content,
                              onGestureLock: (locked) {
                                if (mounted) {
                                  setState(() => scrollLocked = locked);
                                }
                              },
                              child: AnswerView(
                                session: session!,
                                labels: const AnswerLabels(
                                  surface: '인터랙티브 콘텐츠',
                                  reset: '초기화',
                                  expand: '크게 보기',
                                  close: '닫기',
                                  viewAsText: '텍스트로 보기',
                                  viewAsInterface: '화면으로 보기',
                                  incomplete: '일부 내용을 표시하지 못했습니다.',
                                ),
                              ),
                            ),
                            const SizedBox(height: 28),
                            Semantics(
                              liveRegion: true,
                              child: Text(
                                status,
                                style: TextStyle(
                                  fontSize: 13,
                                  color: color('muted', Colors.grey),
                                ),
                              ),
                            ),
                            const SizedBox(height: 14),
                            Container(
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: color('surface', Colors.white),
                                border: Border.all(
                                  color: color('border', Colors.grey),
                                ),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  TextField(
                                    controller: prompt,
                                    minLines: 2,
                                    maxLines: 5,
                                    style: TextStyle(color: foreground),
                                    decoration: const InputDecoration(
                                      labelText: '만들고 싶은 인터페이스',
                                      hintText: '어떤 도구가 필요한가요?',
                                      border: InputBorder.none,
                                    ),
                                  ),
                                  const SizedBox(height: 12),
                                  DropdownButton<String>(
                                    value: model,
                                    isExpanded: true,
                                    items: [
                                      for (final id in [
                                        'cx/gpt-5.6-sol-medium',
                                        'agy/claude-sonnet-4-6',
                                        'agy/gemini-3.7-flash-medium',
                                      ])
                                        DropdownMenuItem(
                                          value: id,
                                          child: Text(
                                            id,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                    ],
                                    onChanged: (id) {
                                      if (id != null) {
                                        setState(() => model = id);
                                      }
                                    },
                                  ),
                                  FilledButton(
                                    onPressed: busy
                                        ? cancel
                                        : () => generate(prompt.text),
                                    child: Text(busy ? '중단' : '만들기'),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 16),
                            TextButton(
                              onPressed: () =>
                                  setState(() => inspector = !inspector),
                              child: const Text('메시지와 진단 보기'),
                            ),
                            if (inspector)
                              SelectableText(
                                '$messages messages · ${kit.manifest['name']}\n${diagnostics.isEmpty ? '진단 없음' : diagnostics.join('\n')}',
                                style: TextStyle(
                                  color: foreground,
                                  fontSize: 12,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
