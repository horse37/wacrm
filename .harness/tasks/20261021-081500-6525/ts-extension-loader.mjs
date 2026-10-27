export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      specifier.startsWith('.') &&
      !/\.[cm]?js$/.test(specifier) &&
      !specifier.endsWith('.ts')
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
