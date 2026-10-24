import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

// Node's native type stripping requires import specifiers to name the actual
// .ts file, but the source uses .js specifiers so the emitted declarations stay
// valid for consumers. Map relative .js specifiers back to .ts when testing.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const parentURL = context.parentURL;
    if (
      parentURL === undefined ||
      !parentURL.endsWith('.ts') ||
      !specifier.startsWith('.') ||
      !specifier.endsWith('.js')
    ) {
      return nextResolve(specifier, context);
    }

    const typescriptSpecifier = `${specifier.slice(0, -3)}.ts`;
    const typescriptUrl = new URL(typescriptSpecifier, parentURL);
    if (existsSync(fileURLToPath(typescriptUrl))) {
      return nextResolve(typescriptSpecifier, context);
    }

    return nextResolve(specifier, context);
  },
});
