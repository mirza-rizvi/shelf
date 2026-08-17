import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { UNDO_TOAST_MS } from '../lib/constants';
import { sendCmd } from '../lib/messaging';

/** Toast notifications with optional undo (routed to the background). */

interface Toast {
  id: number;
  message: string;
  undoEntryId?: string | null;
}

interface ToastApi {
  show: (message: string, undoEntryId?: string | null) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback((message: string, undoEntryId?: string | null) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, message, undoEntryId }]);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} onShow={show} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
  onShow,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
  onShow: (message: string) => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), UNDO_TOAST_MS);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div className="toast">
      <span>{toast.message}</span>
      {toast.undoEntryId ? (
        <button
          className="btn btn-sm"
          onClick={() => {
            void sendCmd({ cmd: 'undoTrash', entryId: toast.undoEntryId! }).then((res) => {
              onDismiss(toast.id);
              if (!res.ok) onShow('Undo failed — the entry may already be gone.');
            });
          }}
        >
          Undo
        </button>
      ) : null}
      <button className="btn-ghost btn-sm" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>
        ✕
      </button>
    </div>
  );
}
