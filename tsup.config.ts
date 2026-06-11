import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/main.ts',
        'test-sheets': 'src/test-sheets.ts'
    }, // Tu punto de entrada principal
    format: ['cjs', 'esm'],  // Genera tanto CommonJS como ES Modules
    dts: true,               // 🔥 Genera .d.ts y .d.cts automáticamente
    splitting: false,
    sourcemap: true,
    clean: true,             // Limpia la carpeta dist antes de cada build
    target: 'es2021',
    minify: false,           // Falso para facilitar el debugging de quienes usen tu librería
    // Fundamental para NestJS: Mantener nombres de clases y evitar que esbuild rompa los decoradores
    keepNames: true,
    esbuildOptions(options) {
        options.tsconfig = 'tsconfig.json';
    },
});