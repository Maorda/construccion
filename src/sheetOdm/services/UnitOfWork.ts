import { Injectable, Scope } from '@nestjs/common';
import { SheetDocument } from '@sheetOdm/wrapper/sheetDocument';

@Injectable({ scope: Scope.REQUEST })
export class UnitOfWork {
    private readonly identityMap = new Map<string, SheetDocument<any>>();

    register(doc: SheetDocument<any>, pk: string) {
        if (!this.identityMap.has(pk)) {
            this.identityMap.set(pk, doc);
        }
    }

    get(pk: string) { return this.identityMap.get(pk); }
    getAll(): SheetDocument<any>[] {
        return Array.from(this.identityMap.values());
    }

    // Aquí centralizas el guardado de todo lo que cambió
    async flush() {
        const dirty = this.getAll().filter(d => d.isDirty);
        await Promise.all(dirty.map(doc => doc.save()));
    }
}