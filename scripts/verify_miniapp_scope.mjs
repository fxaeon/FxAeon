import ts from 'typescript';
import { moduleSpecifiers } from './verify_architecture.mjs';

export const WALLET_ROUTES = new Map([
  ['functions/api/telegram-wallet.ts', 'createAccessHandler'],
  ['functions/api/miniapp-operator.ts', 'createOperatorHandler'],
]);
export const BOT_ROUTES = new Map([['functions/api/telegram-bot.ts', 'createTelegramBotHandler']]);
export const SERVER_MODULES = new Set(['index.ts', 'http.ts', 'store.ts', 'admissionPolicy.ts', 'operations.ts', 'passkeys.ts', 'privy.ts', 'notifications.ts', 'bot.ts']);

/** Route files are exact two-statement adapters; no extra proxy, handler, or signing code is allowed. */
export function walletRouteViolation(name, source) {
  const handler = WALLET_ROUTES.get(name.replaceAll('\\', '/'));
  if (!handler) return 'unsupported wallet Pages Function';
  return handlerRouteViolation(name, source, handler, '../../server/miniapp-access');
}

export function botRouteViolation(name, source) {
  const handler = BOT_ROUTES.get(name.replaceAll('\\', '/'));
  if (!handler) return 'unsupported bot Pages Function';
  return handlerRouteViolation(name, source, handler, '../../server/miniapp-access/bot');
}

function handlerRouteViolation(name, source, handler, module) {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const [first, second] = file.statements;
  if (file.parseDiagnostics.length || file.statements.length !== 2 || !ts.isImportDeclaration(first)
    || first.moduleSpecifier.text !== module
    || first.importClause?.isTypeOnly || first.importClause?.name) return 'wallet route must import only its reviewed handler';
  const imports = first.importClause?.namedBindings;
  if (!imports || !ts.isNamedImports(imports) || imports.elements.length !== 1
    || imports.elements[0].name.text !== handler || imports.elements[0].propertyName
    || imports.elements[0].isTypeOnly) return 'wallet route must import only its reviewed handler';
  if (!ts.isVariableStatement(second) || second.modifiers?.length !== 1
    || second.modifiers[0].kind !== ts.SyntaxKind.ExportKeyword
    || !(second.declarationList.flags & ts.NodeFlags.Const) || second.declarationList.declarations.length !== 1) {
    return 'wallet route must export only onRequest';
  }
  const declaration = second.declarationList.declarations[0];
  const call = declaration.initializer;
  if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'onRequest' || !call || !ts.isCallExpression(call)
    || !ts.isIdentifier(call.expression) || call.expression.text !== handler || call.arguments.length) {
    return 'wallet route must instantiate its handler without injected authority';
  }
  return null;
}

function botViolations(source) {
  const problems = [];
  const file = ts.createSourceFile('bot.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let sendCount = 0;
  const transport = expression => {
    if (ts.isParenthesizedExpression(expression)) return transport(expression.expression);
    if (ts.isIdentifier(expression)) return ['fetch', 'fetcher', 'send'].includes(expression.text);
    if (ts.isPropertyAccessExpression(expression)) return ['fetch', 'fetcher', 'send'].includes(expression.name.text);
    return ts.isBinaryExpression(expression) && (transport(expression.left) || transport(expression.right));
  };
  const visit = node => {
    if (ts.isImportDeclaration(node) && /^\.\/store(?:\.ts)?$/.test(node.moduleSpecifier.text)) {
      const clause = node.importClause;
      if (!clause?.isTypeOnly) problems.push('bot may import only database types from the admission store');
    }
    if (ts.isCallExpression(node) && transport(node.expression)) {
      sendCount++;
      const target = node.arguments[0];
      if (!target || !ts.isTemplateExpression(target) || target.head.text !== 'https://api.telegram.org/bot'
        || target.templateSpans.length !== 1 || target.templateSpans[0].literal.text !== '/sendMessage'
        || !ts.isIdentifier(target.templateSpans[0].expression) || target.templateSpans[0].expression.text !== 'token') {
        problems.push('bot outbound destination must be the fixed Telegram sendMessage endpoint');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (sendCount !== 1) problems.push('bot must have exactly one reviewed outbound transport');
  if (/\b(?:PRIVY_APP_SECRET|PRIVY_APP_ID|MINIAPP_OPERATOR_TOKEN|admission_users|admission_settings|admission_challenges|admission_invitations|access_operations|eth_sendTransaction|walletClient)\b/.test(source)) {
    problems.push('bot cannot have wallet or admission authority');
  }
  return problems;
}

export function serverModuleViolations(name, source) {
  const problems = [];
  if (!SERVER_MODULES.has(name)) return ['unreviewed server module'];
  for (const specifier of moduleSpecifiers(source, name)) {
    const local = /^\.\/([a-zA-Z]+)(?:\.ts)?$/.exec(specifier);
    const allowed = local ? (name === 'bot.ts' ? ['http', 'store'].includes(local[1]) : SERVER_MODULES.has(`${local[1]}.ts`))
      : (name === 'index.ts' && specifier === '../../functions/api/telegram-admission')
        || ((name === 'index.ts' || name === 'passkeys.ts') && /^@simplewebauthn\/server(?:\/helpers)?$/.test(specifier))
        || (name === 'privy.ts' && specifier === 'canonicalize');
    if (!allowed) problems.push('unreviewed server dependency');
  }
  if (/PRIVATE_KEY|privateKey|PRIVY_AUTHORIZATION_KEY|PRIVY_SIGNER_ID|grantAuthorization|walletDelegated|\b(?:createWalletClient|privateKeyToAccount|generateKey)\s*\(/.test(source)) {
    problems.push('server private-key or delegated signing authority');
  }
  // The notifier signs only its email-verification HMAC, never a wallet transaction.
  const withoutNotifierHmac = name === 'notifications.ts' ? source.replace(/crypto\.subtle\.sign\('HMAC',/g, 'HMAC_ALLOWED(') : source;
  if (/subtle\s*(?:\.\s*sign|\[\s*['"]sign['"]\s*\])\s*\(/.test(withoutNotifierHmac)) problems.push('server signing authority');
  if (!['privy.ts', 'notifications.ts', 'bot.ts'].includes(name) && /\b(?:fetch|send|fetcher)\s*\(/.test(source)) problems.push('outbound request outside reviewed provider adapters');
  if (name === 'bot.ts') problems.push(...botViolations(source));
  if (name === 'privy.ts' && !source.includes("const API = 'https://api.privy.io/v1'")) problems.push('Privy adapter lost its fixed API origin');
  if (name === 'notifications.ts' && (!source.includes("'https://api.resend.com/emails'")
    || !source.includes('https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage'))) problems.push('notification adapter lost its fixed providers');
  if (/['"](?:eth_sign|personal_sign|eth_signTypedData(?:_v4)?|eth_sendRawTransaction)['"]/.test(source)) problems.push('unsupported signing operation');
  return problems;
}
