import 'dart:async';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import 'renderer.dart';
import 'runtime.dart';

/// Host records only; no bytes are uploaded, generated or persisted by the SDK.
class AttachmentRegistry {
  final Map<String, JsonMap> _items = {};
  int _counter = 0;
  final Map<String, ({bool text, bool vision})> _visibility = {};
  JsonMap attach({
    String? id,
    String? url,
    required String name,
    required String mime,
    JsonMap meta = const {},
    bool modelText = false,
    bool modelVision = false,
  }) {
    final key = id ?? 'att-${++_counter}';
    if (!RegExp(r'^[A-Za-z0-9._:-]{1,128}$').hasMatch(key) ||
        _items.containsKey(key)) {
      throw StateError('INVALID_ATTACHMENT');
    }
    if (_items.length >= 200) throw StateError('ATTACHMENT_LIMIT');
    if (url != null && Uri.tryParse(url)?.scheme != 'https') {
      throw StateError('UNSAFE_ATTACHMENT_URL');
    }
    final top = mime.split('/').first;
    final record = <String, dynamic>{
      ...meta,
      'id': key,
      'name': name,
      'mime': mime,
      'kind': ['image', 'video', 'audio'].contains(top) ? top : 'file',
      'url': ?url,
    };
    _items[key] = record;
    _visibility[key] = (text: modelText, vision: modelVision);
    return record;
  }

  JsonMap? get(String id) => _items[id];
  List<String> unknownIds(List<String> ids) =>
      ids.where((id) => !_items.containsKey(id)).toList();
  List<String> get visionIds => _items.keys
      .where(
        (id) =>
            _visibility[id]?.vision == true && _items[id]?['kind'] == 'image',
      )
      .toList();
  List<JsonMap> views() => _items.entries.map((entry) {
    final item = entry.value;
    String clip(String value, int cap) {
      final safe = value.replaceAll(
        RegExp(
          r'''(?:https?:|data:|file:|blob:)[^\s<>"']+''',
          caseSensitive: false,
        ),
        '[host URL omitted]',
      );
      return safe.length > cap ? '${safe.substring(0, cap)}…' : safe;
    }

    final view = <String, dynamic>{
      for (final key in [
        'id',
        'name',
        'mime',
        'kind',
        'width',
        'height',
        'size',
        'duration',
        'alt',
      ])
        if (item[key] != null) key: item[key],
    };
    for (final key in ['name', 'alt']) {
      if (view[key] is String) {
        view[key] = clip(view[key] as String, key == 'name' ? 120 : 300);
      }
    }
    if (item['regions'] is List) {
      view['regions'] = (item['regions'] as List)
          .map(
            (r) => <String, dynamic>{
              ...Map<String, dynamic>.from(r as Map),
              'label': clip(r['label'] as String, 200),
            },
          )
          .toList();
    }
    if (_visibility[entry.key]?.text == true) {
      for (final key in ['description', 'textExtract']) {
        if (item[key] is String) {
          view[key] = clip(
            item[key] as String,
            key == 'description' ? 1000 : 6000,
          );
        }
      }
      final transcript = item['transcript'];
      if (transcript is String) view['transcript'] = clip(transcript, 6000);
      if (transcript is List) {
        view['transcript'] = transcript
            .take(200)
            .map(
              (row) => {
                't': row['t'],
                'text': clip(row['text'] as String, 300),
              },
            )
            .toList();
      }
    }
    return view;
  }).toList();
}

class ResolvedAttachment {
  final String url;
  final String mime;
  final DateTime? expiresAt;
  const ResolvedAttachment({
    required this.url,
    required this.mime,
    this.expiresAt,
  });
}

typedef AttachmentResolver =
    Future<ResolvedAttachment> Function(String id, String purpose);

class ContentHost {
  final AttachmentRegistry attachments;
  final AttachmentResolver resolver;
  final Set<String> origins;
  final Set<String> schemes;
  final Future<void> Function(String id)? open;
  final Future<void> Function(String id)? download;
  final Future<void> Function(String url)? openLink;
  final void Function(String code, String id)? onDiagnostic;
  final int maxBytes;
  const ContentHost({
    required this.attachments,
    required this.resolver,
    this.origins = const {},
    this.schemes = const {'https'},
    this.open,
    this.download,
    this.openLink,
    this.onDiagnostic,
    this.maxBytes = 50 * 1024 * 1024,
  });
  Future<ResolvedAttachment> resolve(
    String id, [
    String purpose = 'display',
  ]) async {
    final manifest = attachments.get(id);
    if (manifest == null) throw StateError('UNKNOWN_ATTACHMENT');
    for (var attempt = 0; attempt < 2; attempt++) {
      final value = await resolver(
        id,
        purpose,
      ).timeout(const Duration(seconds: 8));
      final uri = Uri.tryParse(value.url);
      if (uri == null ||
          !schemes.contains(uri.scheme) ||
          ['data', 'javascript', 'file'].contains(uri.scheme) ||
          uri.userInfo.isNotEmpty ||
          !origins.contains(uri.origin)) {
        throw StateError('MEDIA_URL_BLOCKED');
      }
      if ((manifest['size'] as num? ?? 0) > maxBytes) {
        throw StateError('MEDIA_SIZE_LIMIT');
      }
      if (value.mime != manifest['mime'] ||
          [
            'text/html',
            'image/svg+xml',
            'application/javascript',
          ].contains(value.mime)) {
        throw StateError('MEDIA_TYPE_BLOCKED');
      }
      if (value.expiresAt != null &&
          !value.expiresAt!.isAfter(DateTime.now())) {
        if (attempt == 0) continue;
        throw StateError('MEDIA_URL_EXPIRED');
      }
      return value;
    }
    throw StateError('MEDIA_RESOLVE_FAILED');
  }

  Future<void> followLink(String value) async {
    final uri = Uri.tryParse(value);
    if (uri == null) return;
    if (uri.scheme == 'attachment') {
      await resolve(uri.path, 'open');
      await open?.call(uri.path);
    } else if (uri.scheme == 'mailto' && !uri.hasQuery ||
        uri.scheme == 'https' &&
            origins.contains(uri.origin) &&
            uri.userInfo.isEmpty) {
      await openLink?.call(value);
    }
  }
}

String chooseMediaLayout(List<JsonMap> items) {
  if (items.any((i) => i['kind'] == 'file') ||
      items.map((i) => i['kind']).toSet().length > 1) {
    return 'files';
  }
  if (items.isNotEmpty && ['video', 'audio'].contains(items.first['kind'])) {
    return 'player';
  }
  return items.length == 1
      ? 'hero'
      : items.length == 2
      ? 'compare'
      : items.length <= 6
      ? 'grid'
      : 'carousel';
}

class FileCard extends StatefulWidget {
  final String id;
  final String? caption;
  const FileCard({super.key, required this.id, this.caption});
  @override
  State<FileCard> createState() => _FileCardState();
}

class _FileCardState extends State<FileCard> {
  bool error = false;
  Future<void> action(String kind) async {
    final host = UIProvider.of(context).content;
    try {
      await host?.resolve(widget.id, kind);
      if (kind == 'open') {
        await host?.open?.call(widget.id);
      } else {
        await host?.download?.call(widget.id);
      }
    } catch (_) {
      if (mounted) setState(() => error = true);
      host?.onDiagnostic?.call('MEDIA_ACTION_FAILED', widget.id);
    }
  }

  @override
  Widget build(BuildContext context) {
    final host = UIProvider.of(context).content;
    final item = host?.attachments.get(widget.id);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).dividerColor),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(item?['name'] as String? ?? 'Unknown attachment'),
          if (item != null) Text('${item['mime']} ${item['size'] ?? ''}'),
          if (widget.caption != null) Text(widget.caption!),
          Wrap(
            spacing: 8,
            children: [
              if (host?.open != null && item != null)
                TextButton(
                  onPressed: () => action('open'),
                  child: const Text('Open'),
                ),
              if (host?.download != null && item != null)
                TextButton(
                  onPressed: () => action('download'),
                  child: const Text('Download'),
                ),
            ],
          ),
          if (error || item == null) const Text('Attachment unavailable'),
        ],
      ),
    );
  }
}

class AttachmentMedia extends StatefulWidget {
  final String id;
  final String? alt, caption;
  final bool file;
  final double? seek;
  final bool muted;
  final List<String> regionIds;
  const AttachmentMedia({
    super.key,
    required this.id,
    this.alt,
    this.caption,
    this.file = false,
    this.seek,
    this.muted = true,
    this.regionIds = const [],
  });
  @override
  State<AttachmentMedia> createState() => _AttachmentMediaState();
}

class _AttachmentMediaState extends State<AttachmentMedia> {
  ContentHost? host;
  ResolvedAttachment? value;
  Timer? expiry;
  bool error = false;
  int generation = 0, retries = 0;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = UIProvider.of(context).content;
    if (next != host) {
      host = next;
      load();
    }
  }

  @override
  void didUpdateWidget(AttachmentMedia old) {
    super.didUpdateWidget(old);
    if (old.id != widget.id) {
      retries = 0;
      load();
    }
  }

  Future<void> load() async {
    final run = ++generation;
    expiry?.cancel();
    value = null;
    error = false;
    try {
      final next = await host?.resolve(widget.id);
      if (!mounted || run != generation) return;
      if (next == null) throw StateError('MEDIA_HOST_REQUIRED');
      setState(() => value = next);
      if (next.expiresAt != null) {
        expiry = Timer(
          Duration(
            milliseconds:
                (next.expiresAt!.difference(DateTime.now()).inMilliseconds -
                        1000)
                    .clamp(1000, 2147483647),
          ),
          () => load(),
        );
      }
    } catch (_) {
      if (mounted && run == generation) {
        setState(() => error = true);
        host?.onDiagnostic?.call('MEDIA_RESOLVE_FAILED', widget.id);
      }
    }
  }

  @override
  void dispose() {
    generation++;
    expiry?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final item = host?.attachments.get(widget.id);
    if (widget.file ||
        error ||
        item == null ||
        item['kind'] == 'file' ||
        item['kind'] == 'audio') {
      return FileCard(id: widget.id, caption: widget.caption);
    }
    if (value == null) {
      return Semantics(
        liveRegion: true,
        child: Text('Loading ${item['name']}…'),
      );
    }
    final label =
        widget.alt ?? item['alt'] as String? ?? item['name'] as String;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (item['kind'] == 'image')
          Image.network(
            value!.url,
            semanticLabel: label,
            fit: BoxFit.contain,
            headers: const {},
            errorBuilder: (context, err, stack) {
              if (retries++ == 0) {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (mounted) load();
                });
              }
              return FileCard(id: widget.id);
            },
          )
        else
          _Video(
            url: value!.url,
            seek: widget.seek,
            muted: widget.muted,
            label: label,
          ),
        for (final region in (item['regions'] as List? ?? []).where(
          (r) => widget.regionIds.contains(r['id']),
        ))
          Text('${region['label']} (${region['x']}, ${region['y']})'),
        if (widget.caption != null) Text(widget.caption!),
        if (item['kind'] == 'video')
          Text(
            item['transcript'] is String
                ? item['transcript'] as String
                : 'Transcript not supplied by host.',
          ),
      ],
    );
  }
}

class _Video extends StatefulWidget {
  final String url, label;
  final double? seek;
  final bool muted;
  const _Video({
    required this.url,
    required this.label,
    this.seek,
    required this.muted,
  });
  @override
  State<_Video> createState() => _VideoState();
}

class _VideoState extends State<_Video> {
  late VideoPlayerController player;
  bool error = false;
  @override
  void initState() {
    super.initState();
    start();
  }

  void start() {
    player = VideoPlayerController.networkUrl(Uri.parse(widget.url));
    player
        .initialize()
        .then((_) async {
          await player.setVolume(widget.muted ? 0 : 1);
          if (widget.seek != null) {
            await player.seekTo(
              Duration(milliseconds: (widget.seek! * 1000).round()),
            );
          }
          if (mounted) setState(() {});
        })
        .catchError((_) {
          if (mounted) setState(() => error = true);
        });
  }

  @override
  void didUpdateWidget(_Video old) {
    super.didUpdateWidget(old);
    if (old.url != widget.url) {
      player.dispose();
      start();
    } else if (old.seek != widget.seek && widget.seek != null) {
      player.seekTo(Duration(milliseconds: (widget.seek! * 1000).round()));
    }
  }

  @override
  void dispose() {
    player.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => error
      ? const Text('Player unavailable')
      : !player.value.isInitialized
      ? const Text('Loading player…')
      : Column(
          children: [
            Semantics(
              label: widget.label,
              child: AspectRatio(
                aspectRatio: player.value.aspectRatio,
                child: VideoPlayer(player),
              ),
            ),
            TextButton(
              onPressed: () {
                player.value.isPlaying ? player.pause() : player.play();
                setState(() {});
              },
              child: Text(player.value.isPlaying ? 'Pause' : 'Play'),
            ),
          ],
        );
}

class MediaContent extends StatelessWidget {
  final List<String> ids;
  final String layout;
  final String? caption;
  const MediaContent({
    super.key,
    required this.ids,
    this.layout = 'auto',
    this.caption,
  });
  @override
  Widget build(BuildContext context) {
    final host = UIProvider.of(context).content;
    final items = ids
        .map((id) => host?.attachments.get(id))
        .whereType<JsonMap>()
        .toList();
    final chosen = layout == 'auto' ? chooseMediaLayout(items) : layout;
    final widgets = ids
        .map(
          (id) => AttachmentMedia(
            key: ValueKey(id),
            id: id,
            file: chosen == 'files',
          ),
        )
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (caption != null) Text(caption!),
        if (chosen == 'carousel')
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final child in widgets) SizedBox(width: 260, child: child),
              ],
            ),
          )
        else if (chosen == 'grid' || chosen == 'compare')
          LayoutBuilder(
            builder: (context, size) => Wrap(
              spacing: 16,
              runSpacing: 16,
              children: [
                for (final child in widgets)
                  SizedBox(
                    width: size.maxWidth < 480
                        ? size.maxWidth
                        : (size.maxWidth - 16) / 2,
                    child: child,
                  ),
              ],
            ),
          )
        else
          ...widgets,
      ],
    );
  }
}
