import { Injectable, Scope } from '@nestjs/common';
import { ClassType } from '@sheetOdm/types/query.types';
import { SheetDocument } from '@sheetOdm/wrapper/sheetDocument';
export class UnitOfWork {
    private readonly identityMap = new Map<string, SheetDocument<any>>();

    // Genera una llave única: "User:1" o "Product:1"
    private getCompositeKey(entityClass: Function, pk: string | number): string {
        return `${entityClass.name}:${pk}`;
    }

    // Registra usando la clase para evitar colisiones
    register(doc: SheetDocument<any>, pk: string | number, entityClass: Function) {
        const key = this.getCompositeKey(entityClass, pk);
        if (!this.identityMap.has(key)) {
            this.identityMap.set(key, doc);
        }
    }

    get(pk: string | number, entityClass: Function): SheetDocument<any> | undefined {
        return this.identityMap.get(this.getCompositeKey(entityClass, pk));
    }

    getAll(): SheetDocument<any>[] {
        return Array.from(this.identityMap.values());
    }

    // --- MÉTODOS DE INVALIDACIÓN ---

    // Limpia todo el UoW (para operaciones masivas)
    clear() {
        this.identityMap.clear();
    }

    // Limpia solo los documentos de una entidad específica
    clearByEntity(entityClass: Function) {
        const prefix = `${entityClass.name}:`;
        for (const key of this.identityMap.keys()) {
            if (key.startsWith(prefix)) {
                this.identityMap.delete(key);
            }
        }
    }

    async flush() {
        const dirty = this.getAll().filter(d => (d as any).isDirty);
        await Promise.all(dirty.map(doc => doc.save()));
    }
}