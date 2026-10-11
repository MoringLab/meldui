import React from 'react';
import {Text, View, Pressable} from 'react-native';
import {type NativeViewProps, useUI} from '@engine/renderer-react-native';
function Panel({node,children,runtime,surfaceId}:NativeViewProps){
 const {kit,mode}=useUI(); const t=kit.tokens[mode];
 return <View style={{padding:20,gap:12,borderRadius:kit.tokens.radius,backgroundColor:t.surface}}><Text accessibilityRole="header" style={{fontSize:22,color:t.foreground}}>{String(node.props.title)}</Text>{node.props.detail&&<Text style={{fontSize:16,color:t.muted}}>{String(node.props.detail)}</Text>}{children}{node.props.action&&<Pressable accessibilityRole="button" accessibilityLabel={String(node.props.label)} onPress={()=>void runtime.dispatch(surfaceId,node.id,node.props.action,node.scope)} style={{minHeight:48,justifyContent:'center',backgroundColor:t.accent,padding:12,borderRadius:8}}><Text style={{color:t.onAccent}}>{String(node.props.label)}</Text></Pressable>}</View>;
}
export const customComponents={PartInspector:Panel,EquationControls:Panel,ReservationCard:Panel};
