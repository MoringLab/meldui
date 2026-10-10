import { type NativeViewProps, useUI } from "@engine/renderer-react-native";
import React from "react";
import { Platform, Pressable, Text, View } from "react-native";

/**
 * Stand-in for a host's native design system. The brand kit swaps these in for the built-in
 * Button and Card; props and actions mean exactly what they mean in the core kits.
 */
export function BrandButton({ node, runtime, surfaceId }: NativeViewProps) {
  const { kit, mode } = useUI();
  const t = kit.tokens[mode];
  const p = node.props;
  const variant = String(p.variant ?? "primary");
  const filled = variant === "primary";
  return (
    <Pressable
      testID="brand-button"
      accessibilityRole="button"
      accessibilityLabel={String(p.label)}
      accessibilityState={{ disabled: Boolean(p.disabled) }}
      disabled={Boolean(p.disabled)}
      android_ripple={{ color: `${t.onAccent}33`, borderless: false }}
      onPress={() => void runtime.dispatch(surfaceId, node.id, p.action, node.scope)}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        minHeight: 52,
        paddingHorizontal: 26,
        borderRadius: 999,
        borderWidth: 2,
        borderColor: variant === "quiet" ? "transparent" : t.accent,
        backgroundColor: filled ? t.accent : variant === "secondary" ? t.surface : "transparent",
        justifyContent: "center",
        opacity: p.disabled ? 0.5 : 1,
        transform: [{ translateY: pressed ? 3 : 0 }],
        ...(filled && Platform.OS === "android" ? { elevation: pressed ? 0 : 4 } : {}),
      })}
    >
      <Text style={{ color: filled ? t.onAccent : t.accent, fontSize: 17, fontWeight: "800" }}>
        {String(p.label)} →
      </Text>
    </Pressable>
  );
}

export function BrandCard({ node, children }: NativeViewProps) {
  const { kit, mode } = useUI();
  const t = kit.tokens[mode];
  return (
    <View
      testID="brand-card"
      style={{
        borderRadius: kit.tokens.radius,
        borderWidth: 2,
        borderColor: t.border,
        backgroundColor: t.surface,
        padding: 20,
        paddingLeft: 28,
        gap: 14,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          position: "absolute",
          left: 10,
          top: 16,
          bottom: 16,
          width: 6,
          borderRadius: 3,
          backgroundColor: t.accent,
        }}
      />
      {node.props.title ? (
        <Text
          accessibilityRole="header"
          style={{ color: t.foreground, fontSize: 22, fontWeight: "800" }}
        >
          {String(node.props.title)}
        </Text>
      ) : null}
      {children}
    </View>
  );
}
export const brandComponents = { BrandButton, BrandCard };
