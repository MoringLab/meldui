import 'package:flutter/material.dart';
import 'package:engine_flutter/engine_flutter.dart';

/// Stand-in for a host's Flutter design system. The brand kit swaps these in for the built-in
/// Button and Card; props and actions mean exactly what they mean in the core kits.
Map<String, EngineWidgetBuilder> brandComponents(UIKit kit, bool dark) {
  Color color(String key) => Color(
    int.parse(
      (kit.colors(dark)[key] as String).replaceFirst('#', 'ff'),
      radix: 16,
    ),
  );
  return {
    'BrandButton': (context, node, children, runtime, sid, scope) {
      final p = Map<String, dynamic>.from(node['props'] as Map);
      final variant = (p['variant'] as String?) ?? 'primary';
      final accent = color('accent');
      final filled = variant == 'primary';
      final disabled = p['disabled'] == true;
      return Align(
        alignment: AlignmentDirectional.centerStart,
        child: Semantics(
          button: true,
          label: displayValue(p['label']),
          enabled: !disabled,
          child: Material(
            key: const ValueKey('brand-button'),
            color: filled
                ? accent
                : variant == 'secondary'
                ? color('surface')
                : Colors.transparent,
            elevation: filled ? 4 : 0,
            shape: StadiumBorder(
              side: BorderSide(
                color: variant == 'quiet' ? Colors.transparent : accent,
                width: 2,
              ),
            ),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: disabled
                  ? null
                  : () => runtime.dispatch(
                      sid,
                      node['id'] as String,
                      Map<String, dynamic>.from(p['action'] as Map),
                      scope,
                    ),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 52),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 26),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '${displayValue(p['label'])} →',
                        style: TextStyle(
                          color: filled ? color('onAccent') : accent,
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    },
    'BrandCard': (context, node, children, runtime, sid, scope) {
      final p = Map<String, dynamic>.from(node['props'] as Map);
      return Container(
        key: const ValueKey('brand-card'),
        padding: const EdgeInsets.fromLTRB(28, 20, 20, 20),
        decoration: BoxDecoration(
          color: color('surface'),
          border: Border.all(color: color('border'), width: 2),
          borderRadius: BorderRadius.circular(kit.radius),
        ),
        child: Stack(
          children: [
            Positioned(
              left: -18,
              top: 0,
              bottom: 0,
              child: Container(
                width: 6,
                decoration: BoxDecoration(
                  color: color('accent'),
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (p['title'] != null)
                  Semantics(
                    header: true,
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: Text(
                        displayValue(p['title']),
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ),
                for (var i = 0; i < children.length; i++) ...[
                  if (i > 0) const SizedBox(height: 14),
                  children[i],
                ],
              ],
            ),
          ],
        ),
      );
    },
  };
}
