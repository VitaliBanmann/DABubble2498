import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { Storage, getDownloadURL, ref, uploadBytes } from '@angular/fire/storage';
import { Observable, from } from 'rxjs';
import { MessageAttachment } from './message.service';

@Injectable({
    providedIn: 'root',
})
export class AttachmentService {
    constructor(
        private readonly storage: Storage,
        private readonly injector: EnvironmentInjector,
    ) {}

    uploadMessageAttachments(
        messageId: string,
        files: File[],
    ): Observable<MessageAttachment[]> {
        return from(this.uploadAll(messageId, files));
    }

    private async uploadAll(
        messageId: string,
        files: File[],
    ): Promise<MessageAttachment[]> {
        const uploads = files.map((file, index) =>
            this.uploadSingle(messageId, file, index),
        );
        return Promise.all(uploads);
    }

    private async uploadSingle(
        messageId: string,
        file: File,
        index: number,
    ): Promise<MessageAttachment> {
        const safeName = this.safeFileName(file.name, index);
        const path = `attachments/${messageId}/${safeName}`;
        const url = await this.uploadAndResolveUrl(path, file);
        return {
            name: file.name,
            path,
            url,
            size: file.size,
            contentType: file.type || 'application/octet-stream',
            isImage: file.type.startsWith('image/'),
        };
    }

    private async uploadAndResolveUrl(path: string, file: File): Promise<string> {
        return runInInjectionContext(this.injector, async () => {
            const fileRef = ref(this.storage, path);
            const snapshot = await uploadBytes(fileRef, file, {
                contentType: file.type || undefined,
            });
            return getDownloadURL(snapshot.ref);
        });
    }

    private safeFileName(name: string, index: number): string {
        const cleaned = name
            .normalize('NFKD')
            .replace(/[^a-zA-Z0-9._-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 80);
        const suffix = `${Date.now()}-${index}`;
        return `${suffix}-${cleaned || 'file'}`;
    }
}
