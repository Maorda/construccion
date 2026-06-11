import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js'; // Importa tu módulo principal real
import { RelationManager } from './sheetOdm/services/relation-manager.service.js';
import { ObreroEntity } from './planilla/entities/ObreroEntity.js';

async function smokeTest() {
    console.log('🚀 Iniciando prueba de humo real...');

    const app = await NestFactory.createApplicationContext(AppModule);

    try {
        const relationManager = app.get(RelationManager);
        const repoUser = relationManager.getRepositoryForEntity(ObreroEntity);
        const emailToFind = `test-${Date.now()}@odm.com`;

        console.log(`📝 Creando registro: ${emailToFind}`);
        const nuevoUsuario = repoUser.create({
            nombre: 'Test de Humo Real',
            dni: '12345678'
        });

        await repoUser.save(nuevoUsuario);
        console.log('💾 Guardado localmente. Esperando sincronización...');

        // Ciclo de verificación (Polling inteligente)
        let found = false;
        for (let i = 0; i < 5; i++) {
            await new Promise(r => setTimeout(r, 5000)); // Espera 5s
            const users = await repoUser.find({ where: { email: emailToFind } });
            if (users.length > 0) {
                found = true;
                break;
            }
            console.log(`⏳ Intentando verificar sincronización... (${i + 1}/5)`);
        }

        if (found) {
            console.log('✅ ¡ÉXITO! El registro fue procesado por el Outbox y sincronizado.');
        } else {
            throw new Error('❌ El registro no apareció en el destino tras 25 segundos.');
        }

    } catch (error) {
        console.error('❌ La prueba de humo falló:', error);
        process.exit(1); // Importante para que el CI/CD detecte el fallo
    } finally {
        await app.close();
    }
}

smokeTest();