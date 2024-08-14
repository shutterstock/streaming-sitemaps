// List from VS Code:
//   https://github.com/microsoft/vscode/blob/63f82f60b00319ca76632aa4e4c5770669959227/src/vs/base/common/strings.ts#L1152
export const invisibleCharsRegex =
  // eslint-disable-next-line no-misleading-character-class,no-control-regex
  /[\u{0000}-\u{0008}\u{000B}-\u{000C}\u{000E}-\u{001F}\u{007F}\u{0081}-\u{00A0}\u{00AD}\u{034F}\u{061C}\u{0E00}\u{17B4}-\u{17B5}\u{180B}-\u{180F}\u{181A}-\u{181F}\u{1878}-\u{187F}\u{18AA}-\u{18AF}\u{2000}-\u{200F}\u{202A}-\u{202F}\u{205F}-\u{206F}\u{3000}\u{A48D}-\u{A48F}\u{A4A2}-\u{A4A3}\u{A4B4}\u{A4C1}\u{A4C5}\u{AAF6}\u{FB0F}\u{FE00}-\u{FE0F}\u{FEFF}\u{FFA0}\u{FFF0}-\u{FFFC}\u{11D45}\u{11D97}\u{1D173}-\u{1D17A}\u{E0000}-\u{E007F}]/gu;
