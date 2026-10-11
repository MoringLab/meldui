import 'package:flutter/material.dart';
import 'package:engine_flutter/engine_flutter.dart';

Map<String, EngineWidgetBuilder> customComponents() {
  Widget panel(
    BuildContext context,
    Map<String, dynamic> node,
    List<Widget> children,
    UIRuntime runtime,
    String sid,
    String scope,
  ) {
    final p = node['props'] as Map;
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            header: true,
            child: Text(
              displayValue(p['title']),
              style: Theme.of(context).textTheme.titleLarge,
            ),
          ),
          if (p['detail'] != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(displayValue(p['detail'])),
            ),
          ...children,
          if (p['action'] is Map)
            FilledButton(
              onPressed: () => runtime.dispatch(
                sid,
                node['id'] as String,
                Map<String, dynamic>.from(p['action'] as Map),
                scope,
              ),
              child: Text(displayValue(p['label'])),
            ),
        ],
      ),
    );
  }

  return {
    'PartInspector': panel,
    'EquationControls': panel,
    'ReservationCard': panel,
  };
}
