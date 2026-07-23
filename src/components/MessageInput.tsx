import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import PlusMenu from './MessageInputActions/PlusMenu';
import Sources from './MessageInputActions/Sources';
import ModeSelector from './MessageInputActions/ModeSelector';
import ModelSelector from './MessageInputActions/ChatModelSelector';
import { useChat } from '@/lib/hooks/useChat';

/* While a turn streams, the send button becomes a stop button — halting a
   run is a first-class action, not a missing feature. */
const SendOrStopButton = ({
  loading,
  disabled,
  onStop,
}: {
  loading: boolean;
  disabled: boolean;
  onStop: () => void;
}) =>
  loading ? (
    <button
      type="button"
      onClick={onStop}
      aria-label="Stop generating"
      className="bg-black dark:bg-white text-white dark:text-black hover:opacity-85 transition duration-100 rounded-full p-2"
    >
      <Square size={17} fill="currentColor" />
    </button>
  ) : (
    <button
      disabled={disabled}
      aria-label="Send"
      className="bg-[#24A0ED] text-white disabled:text-black/50 dark:disabled:text-white/50 hover:bg-opacity-85 transition duration-100 disabled:bg-[#e0e0dc79] dark:disabled:bg-[#ececec21] rounded-full p-2"
    >
      <ArrowUp className="bg-background" size={17} />
    </button>
  );

const MessageInput = () => {
  const { loading, sendMessage, stopGeneration } = useChat();

  const [message, setMessage] = useState('');

  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;

      const isInputFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.hasAttribute('contenteditable');

      if (e.key === '/' && !isInputFocused) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <form
      onSubmit={(e) => {
        if (loading) return;
        e.preventDefault();
        sendMessage(message);
        setMessage('');
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !loading) {
          e.preventDefault();
          sendMessage(message);
          setMessage('');
        }
      }}
      className="relative bg-light-secondary dark:bg-dark-secondary p-4 flex flex-col rounded-2xl overflow-visible border border-light-200 dark:border-dark-200 shadow-sm shadow-light-200/10 dark:shadow-black/20 transition-all duration-200 focus-within:border-light-300 dark:focus-within:border-dark-300"
    >
      <TextareaAutosize
        ref={inputRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="transition bg-transparent dark:placeholder:text-white/50 placeholder:text-sm text-sm dark:text-white resize-none focus:outline-none w-full px-2 max-h-24 lg:max-h-36 xl:max-h-48 flex-grow flex-shrink"
        placeholder="Ask a follow-up"
      />
      {/* The model, focus and depth controls belong on every turn, not just the
          first one — switching model mid-conversation is the normal case, and
          the home screen was previously the only place to do it. Always
          visible (Perplexity ground truth) rather than gated behind the
          textarea growing to 2+ rows, which hid every control in normal use. */}
      <div className="flex flex-row items-center justify-between w-full pt-3">
        <div className="flex flex-row items-center space-x-1">
          <PlusMenu />
          <ModeSelector />
          <Sources />
        </div>
        <div className="flex flex-row items-center space-x-1">
          <ModelSelector />
          <SendOrStopButton
            loading={loading}
            disabled={message.trim().length === 0}
            onStop={stopGeneration}
          />
        </div>
      </div>
    </form>
  );
};

export default MessageInput;
