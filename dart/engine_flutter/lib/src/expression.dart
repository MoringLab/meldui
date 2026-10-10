import 'dart:math' as math;
import 'dart:convert';

/// Reject untrusted shapes before recursion or state mutation.
void assertSafeJson(dynamic input, [int maxDepth = 50]) {
  var count = 0;
  void walk(dynamic value, int depth) {
    if (++count > 100000 || depth > maxDepth) throw StateError('JSON_LIMIT');
    if (value is num && !value.isFinite) throw StateError('NON_FINITE_NUMBER');
    if (value is Map) {
      for (final entry in value.entries) {
        if (['__proto__', 'prototype', 'constructor'].contains(entry.key)) {
          throw StateError('UNSAFE_KEY');
        }
        walk(entry.value, depth + 1);
      }
    } else if (value is List) {
      for (final child in value) {
        walk(child, depth + 1);
      }
    }
  }

  walk(input, 0);
}

/// Resolve A2UI's relative pointer extension consistently with TypeScript.
String resolvePath(String path, [String scope = '/']) {
  final result = path.startsWith('/')
      ? path
      : '${scope == '/' ? '' : scope}/$path';
  for (final segment in result.split('/').skip(1)) {
    if (RegExp(r'~(?![01])').hasMatch(segment)) {
      throw StateError('INVALID_POINTER');
    }
    if ([
      '__proto__',
      'prototype',
      'constructor',
    ].contains(segment.replaceAll('~1', '/').replaceAll('~0', '~'))) {
      throw StateError('UNSAFE_PATH');
    }
  }
  return result.isEmpty ? '/' : result;
}

bool _truth(dynamic value) =>
    value != null && value != false && value != 0 && value != '';
num _number(dynamic value) {
  if (value is! num || !value.isFinite) throw StateError('EXPECTED_NUMBER');
  return value;
}

String displayValue(dynamic value) {
  if (value == null) return '';
  if (value is Map || value is List) return jsonEncode(value);
  if (value is double && value == value.truncateToDouble()) {
    return value.toInt().toString();
  }
  return value.toString();
}

/// Evaluate the portable bounded expression AST, with lazy conditional branches.
dynamic evaluateExpression(dynamic expression, dynamic Function(String) read) {
  assertSafeJson(expression, 34);
  var astNodes = 0;
  void boundAst(dynamic item) {
    if (++astNodes > 256) throw StateError("EXPRESSION_LIMIT");
    if (item is Map && item["args"] is List) {
      for (final x in item["args"]) {
        boundAst(x);
      }
    }
  }

  boundAst(expression);
  var nodes = 0;
  var iterations = 0;
  var locals = <String, dynamic>{};
  int loop(dynamic n) {
    final length = _number(n);
    if (length != length.round() ||
        length < 0 ||
        length > 1000 ||
        (iterations += length.toInt()) > 1000) {
      throw StateError("ITERATION_LIMIT");
    }
    return length.toInt();
  }

  dynamic evaluate(dynamic value, int depth) {
    if (++nodes > 10000 || depth > 16) throw StateError('EXPRESSION_LIMIT');
    if (value == null || value is String || value is bool || value is num) {
      return value;
    }
    if (value is! Map) throw StateError('INVALID_EXPRESSION');
    if (value['ref'] is String && value.length == 1) {
      return locals.containsKey(value['ref'])
          ? locals[value['ref']]
          : read(value['ref'] as String);
    }
    if (value.keys.any((key) => key != 'op' && key != 'args') ||
        value['op'] is! String ||
        value['args'] is! List) {
      throw StateError('INVALID_EXPRESSION');
    }
    final args = value['args'] as List;
    if (args.length > 1000) throw StateError('ARRAY_LIMIT');
    dynamic at(int i) {
      if (i >= args.length) throw StateError('MISSING_OPERAND');
      return evaluate(args[i], depth + 1);
    }

    final op = value['op'];
    switch (op) {
      case 'sin':
        return _number(math.sin(_number(at(0))));
      case 'cos':
        return _number(math.cos(_number(at(0))));
      case 'exp':
        return _number(math.exp(_number(at(0))));
      case 'log':
        return _number(math.log(_number(at(0))));
      case 'sqrt':
        return _number(math.sqrt(_number(at(0))));
      case 'floor':
        return _number(at(0)).floor();
      case 'pow':
        return _number(math.pow(_number(at(0)), _number(at(1))));
      case 'clamp':
        return math.min(
          _number(at(2)),
          math.max(_number(at(1)), _number(at(0))),
        );
      case 'lerp':
        return _number(
          _number(at(0)) + (_number(at(1)) - _number(at(0))) * _number(at(2)),
        );
      case 'rng':
        return seededRandom(_number(at(0)), _number(at(1)));
      case 'get':
        final target = at(0);
        final key = at(1);
        if (target is! List || key is! num || key != key.round()) {
          throw StateError('EXPECTED_ARRAY_INDEX');
        }
        return key < 0 || key >= target.length ? null : target[key.toInt()];
      case 'numberFormat':
        final digits = args.length > 1 ? _number(at(1)) : 2;
        if (digits != digits.round() || digits < 0 || digits > 8) {
          throw StateError('ROUND_LIMIT');
        }
        return _number(at(0)).toStringAsFixed(digits.toInt());
      case 'range':
        return List.generate(loop(at(0)), (i) => i);
      case 'map':
      case 'filter':
      case 'reduce':
      case 'scan':
      case 'series':
        final recurrence = op == 'scan';
        final series = op == 'series';
        final source = recurrence ? at(2) : at(0);
        final length = loop(
          recurrence || series ? source : (source is List ? source.length : -1),
        );
        final values = source is List
            ? source
            : List.generate(length, (i) => i);
        var acc = op == 'reduce'
            ? at(2)
            : recurrence
            ? at(0)
            : null;
        final output = <dynamic>[if (recurrence) acc];
        final previous = locals;
        try {
          for (var i = 0; i < length; i++) {
            locals = {
              ...previous,
              r'$item': values[i],
              r'$index': i,
              r'$acc': acc,
            };
            final result = evaluate(args[1], depth + 1);
            if (op == 'reduce' || recurrence) acc = result;
            if (op == 'filter') {
              if (_truth(result)) output.add(values[i]);
            } else if (op != 'reduce') {
              output.add(result);
            }
          }
        } finally {
          locals = previous;
        }
        return op == 'reduce' ? acc : output;
      case 'if':
        return _truth(at(0)) ? at(1) : at(2);
      case 'and':
        return _truth(at(0)) && _truth(at(1));
      case 'or':
        return _truth(at(0)) || _truth(at(1));
      case 'not':
        return !_truth(at(0));
      case 'add':
        var result = 0.0;
        for (var i = 0; i < args.length; i++) {
          result += _number(at(i));
        }
        return _number(result);
      case 'sub':
        return _number(_number(at(0)) - _number(at(1)));
      case 'mul':
        var result = 1.0;
        for (var i = 0; i < args.length; i++) {
          result *= _number(at(i));
        }
        return _number(result);
      case 'div':
      case 'mod':
        final a = _number(at(0));
        final b = _number(at(1));
        if (b == 0) throw StateError('DIVISION_BY_ZERO');
        return _number(op == 'div' ? a / b : a.remainder(b));
      case 'eq':
        return at(0) == at(1);
      case 'ne':
        return at(0) != at(1);
      case 'lt':
        return _number(at(0)) < _number(at(1));
      case 'lte':
        return _number(at(0)) <= _number(at(1));
      case 'gt':
        return _number(at(0)) > _number(at(1));
      case 'gte':
        return _number(at(0)) >= _number(at(1));
      case 'round':
        final v = _number(at(0));
        final places = _number(at(1));
        if (places != places.round() || places.abs() > 8) {
          throw StateError('ROUND_LIMIT');
        }
        final scale = math.pow(10, places);
        return (v * scale + 0.5).floor() / scale;
      case 'array':
        return args.map((arg) => evaluate(arg, depth + 1)).toList();
      case 'format':
        final template = at(0);
        if (template is! String) throw StateError('EXPECTED_STRING');
        return template.replaceAllMapped(
          RegExp(r'\{(\d+)\}'),
          (match) => displayValue(at(int.parse(match[1]!) + 1)),
        );
      case 'sum':
      case 'count':
      case 'min':
      case 'max':
        final values = at(0);
        if (values is! List || values.length > 1000) {
          throw StateError('ARRAY_LIMIT');
        }
        if (op == 'count') return values.length;
        final numbers = values.map(_number).toList();
        if (op == 'sum') return _number(numbers.fold<num>(0, (a, b) => a + b));
        if (numbers.isEmpty) throw StateError('EMPTY_ARRAY');
        return numbers.reduce(op == 'min' ? math.min : math.max);
      default:
        throw StateError('UNKNOWN_OPERATOR');
    }
  }

  return evaluate(expression, 0);
}

double seededRandom(num seed, num draw) {
  if (seed != seed.round() ||
      draw != draw.round() ||
      draw < 0 ||
      draw > 1000000) {
    throw StateError('RNG_INDEX_LIMIT');
  }
  var x = (seed.toInt() ^ ((draw.toInt() + 1) * 0x9e3779b9)) & 0xffffffff;
  x = ((x ^ (x >>> 16)) * 0x21f0aaad) & 0xffffffff;
  x = ((x ^ (x >>> 15)) * 0x735a2d97) & 0xffffffff;
  return ((x ^ (x >>> 15)) & 0xffffffff) / 4294967296;
}
