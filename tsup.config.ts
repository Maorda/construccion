import { defineConfig } from 'tsup';

export default defineConfig({
    // 1. CAMBIO DE ENTRADA: Apuntamos al archivo "barril" (index.ts)
    // Ya no apuntamos a main.ts para evitar empaquetar código de inicialización (app.listen)
    entry: {
        index: 'src/index.ts',
    },

    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    target: 'es2022',

    // 2. CAMBIO DE MINIFICACIÓN: Recomendado en 'false' para librerías backend
    // Minificar en backend no ahorra mucho impacto de red y dificulta la lectura
    // de los "stack traces" (trazas de error) a los desarrolladores que usen tu librería.
    minify: false,

    keepNames: true, // Fundamental para NestJS (preserva nombres para inyección de dependencias)

    // 3. EXCLUSIÓN AMPLIADA: Nos aseguramos de que TODO lo pesado y del ecosistema
    // NestJS quede fuera del bundle final. El usuario final debe proveerlas.
    external: [
        '@nestjs/common',
        '@nestjs/core',
        '@nestjs/config',
        '@nestjs/axios',
        '@nestjs/cache-manager',
        '@prisma/client',
        'reflect-metadata',
        'joi',
        'dayjs',
        'rxjs',
        'cache-manager',
        'googleapis' // Googleapis es enorme, mejor que la instale el usuario (dependencies)
    ],

    esbuildOptions(options) {
        options.tsconfig = 'tsconfig.json';
    },
});