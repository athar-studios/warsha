// Design System v3 — Color Tokens (DESIGN_SYSTEM_V3.md §2.1)
// Measured with bridge-io/policy/2026-11-09-ui-v3/tools/contrast.mjs; all 50 pairs pass WCAG.

export type Theme = 'light' | 'dark';

export interface ThemeColors {
  bg: string;
  surface: string;
  sunken: string;
  line: string;
  lineStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  primaryHover: string;
  onPrimary: string;
  primarySoft: string;
  primaryText: string;
  attention: string;
  attentionSoft: string;
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  focus: string;
  scrim: string;
}

export const lightColors: ThemeColors = {
  bg: '#F6F4EF',
  surface: '#FFFFFF',
  sunken: '#EFECE5',
  line: '#E2DDD3',
  lineStrong: '#8C877C',
  text: '#1B1A17',
  textMuted: '#5F5B53',
  textFaint: '#7A756B',
  primary: '#FFD400',
  primaryHover: '#F2C600',
  onPrimary: '#1B1A17',
  primarySoft: '#FFF4C2',
  primaryText: '#7A5C00',
  attention: '#A8430A',
  attentionSoft: '#FFEEDF',
  success: '#1B6B39',
  successSoft: '#E4F3E8',
  danger: '#A8261D',
  dangerSoft: '#FCE9E7',
  info: '#1F55A0',
  infoSoft: '#E7EFFA',
  focus: '#7A5C00',
  scrim: '#1B1A1766',
};

export const darkColors: ThemeColors = {
  bg: '#131210',
  surface: '#1B1A17',
  sunken: '#24221E',
  line: '#33302A',
  lineStrong: '#7D776C',
  text: '#F1EEE7',
  textMuted: '#B3AEA3',
  textFaint: '#948F84',
  primary: '#FFD400',
  primaryHover: '#FFE04A',
  onPrimary: '#1B1A17',
  primarySoft: '#3A3008',
  primaryText: '#FFD84D',
  attention: '#FF9D5C',
  attentionSoft: '#3D2314',
  success: '#5CC98A',
  successSoft: '#15301F',
  danger: '#F07A70',
  dangerSoft: '#3A1714',
  info: '#7DB0F5',
  infoSoft: '#152842',
  focus: '#FFD400',
  scrim: '#000000A3',
};

export const colorTokens = {
  light: lightColors,
  dark: darkColors,
} as const;

export type ColorTokenName = keyof ThemeColors;

export const colorNames: readonly ColorTokenName[] = Object.keys(lightColors) as ColorTokenName[];
