import ChatWindow from '@/components/ChatWindow';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chat - Simplicity',
  description: 'Chat with the internet, chat with Simplicity.',
};

const Home = () => {
  return <ChatWindow />;
};

export default Home;
