import { Message } from '../services/message.service';

/** User/channel mention option used in the composer. */
export interface MentionCandidate {
    id: string;
    label: string;
}

/** Target suggestion used for compose routing shortcuts. */
export interface ComposeTargetSuggestion {
    kind: 'channel' | 'user';
    id: string;
    label: string;
    value: string;
    subtitle: string;
}

/** Visual message group rendered as one chat block. */
export interface MessageGroup {
    id: string;
    senderId: string;
    isOwn: boolean;
    startedAt: Message['timestamp'];
    messages: Message[];
}
