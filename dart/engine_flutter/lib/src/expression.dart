import 'dart:math' as math;

/// Reject untrusted shapes before recursion or state mutation.
void assertSafeJson(dynamic input, [int maxDepth = 50]) {
  var count = 0;
  void walk(dynamic value, int depth) {
    if (++count > 100000 || depth > maxDepth) throw StateError('JSON_LIMIT');
    if (value is num && !value.isFinite) throw StateError('NON_FINITE_NUMBER');
    if (value is Map) {
      for (final entry in value.entries) {
        if (['__proto__', 'prototype', 'constructor'].contains(entry.key)) throw StateError('UNSAFE_KEY');
        walk(entry.value, depth + 1);
      }
    } else if (value is List) {
      for (final child in value) { walk(child, depth + 1); }
    }
  }
  walk(input, 0);
}

/// Resolve A2UI's relative pointer extension consistently with TypeScript.
String resolvePath(String path, [String scope = '/']) {
  final result = path.startsWith('/') ? path : '${scope == '/' ? '' : scope}/$path';
  for (final segment in result.split('/').skip(1)) {
    if (RegExp(r'~(?![01])').hasMatch(segment)) throw StateError('INVALID_POINTER');
    if (['__proto__', 'prototype', 'constructor'].contains(segment.replaceAll('~1', '/').replaceAll('~0', '~'))) throw StateError('UNSAFE_PATH');
  }
  return result.isEmpty ? '/' : result;
}

bool _truth(dynamic value) => value != null && value != false && value != 0 && value != '';
num _number(dynamic value) { if (value is! num || !value.isFinite) throw StateError('EXPECTED_NUMBER'); return value; }
String displayValue(dynamic value) {
  if (value == null) return '';
  if (value is double && value == value.truncateToDouble()) return value.toInt().toString();
  return value.toString();
}

/// Evaluate the portable bounded expression AST, with lazy conditional branches.
dynamic evaluateExpression(dynamic expression, dynamic Function(String) read) {
  assertSafeJson(expression, 34);
  var nodes = 0;
  dynamic evaluate(dynamic value, int depth) {
    if (++nodes > 256 || depth > 16) throw StateError('EXPRESSION_LIMIT');
    if (value == null || value is String || value is bool || value is num) return value;
    if (value is! Map) throw StateError('INVALID_EXPRESSION');
    if (value['ref'] is String && value.length == 1) return read(value['ref'] as String);
    if (value.keys.any((key) => key != 'op' && key != 'args') || value['op'] is! String || value['args'] is! List) throw StateError('INVALID_EXPRESSION');
    final args = value['args'] as List;
    if (args.length > 1000) throw StateError('ARRAY_LIMIT');
    dynamic at(int i) { if (i >= args.length) throw StateError('MISSING_OPERAND'); return evaluate(args[i], depth + 1); }
    final op = value['op'];
    switch (op) {
      case 'if': return _truth(at(0)) ? at(1) : at(2);
      case 'and': return _truth(at(0)) && _truth(at(1));
      case 'or': return _truth(at(0)) || _truth(at(1));
      case 'not': return !_truth(at(0));
      case 'add': return _number(_number(at(0)) + _number(at(1)));
      case 'sub': return _number(_number(at(0)) - _number(at(1)));
      case 'mul': return _number(_number(at(0)) * _number(at(1)));
      case 'div': case 'mod':
        final a = _number(at(0)); final b = _number(at(1));
        if (b == 0) throw StateError('DIVISION_BY_ZERO');
        return _number(op == 'div' ? a / b : a.remainder(b));
      case 'eq': return at(0) == at(1);
      case 'ne': return at(0) != at(1);
      case 'lt': return _number(at(0)) < _number(at(1));
      case 'lte': return _number(at(0)) <= _number(at(1));
      case 'gt': return _number(at(0)) > _number(at(1));
      case 'gte': return _number(at(0)) >= _number(at(1));
      case 'round':
        final v = _number(at(0)); final places = _number(at(1));
        if (places != places.round() || places.abs() > 8) throw StateError('ROUND_LIMIT');
        final scale = math.pow(10, places); return (v * scale + 0.5).floor() / scale;
      case 'array': return args.map((arg) => evaluate(arg, depth + 1)).toList();
      case 'format':
        final template = at(0); if (template is! String) throw StateError('EXPECTED_STRING');
        return template.replaceAllMapped(RegExp(r'\{(\d+)\}'), (match) => displayValue(at(int.parse(match[1]!) + 1)));
      case 'sum': case 'count': case 'min': case 'max':
        final values = at(0); if (values is! List || values.length > 1000) throw StateError('ARRAY_LIMIT');
        if (op == 'count') return values.length;
        final numbers = values.map(_number).toList();
        if (op == 'sum') return _number(numbers.fold<num>(0, (a, b) => a + b));
        if (numbers.isEmpty) throw StateError('EMPTY_ARRAY');
        return numbers.reduce(op == 'min' ? math.min : math.max);
      default: throw StateError('UNKNOWN_OPERATOR');
    }
  }
  return evaluate(expression, 0);
}
