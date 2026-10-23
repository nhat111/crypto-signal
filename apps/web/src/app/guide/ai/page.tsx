import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import { Section, Steps, Warning } from '@/components/guide/GuideBlocks';
import { GuideTabs } from '@/components/guide/GuideTabs';
import { CopyButton } from '@/components/CopyButton';
import { AI_GUIDE_PATH } from '@/lib/aiPrompt';

export const metadata: Metadata = {
  title: 'Hỏi AI · Market Health Monitor',
  description: 'Hướng dẫn đọc dashboard để dán vào ChatGPT hoặc Claude trước khi gửi screenshot.',
};

// Read at build from the file served at AI_GUIDE_PATH, so the page and the
// URL a chat AI fetches can never hold two versions of the guide.
const GUIDE = readFileSync(path.join(process.cwd(), 'public', AI_GUIDE_PATH), 'utf8');

export default function AiGuidePage() {
  return (
    <div className="mx-auto max-w-3xl pb-24">
      <header className="border-b border-slate-800 pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Hỏi AI về dashboard</h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-slate-400">
          ChatGPT hay Claude đọc được số trên ảnh, nhưng không biết quy tắc phía sau. Đưa cho nó hướng dẫn dưới đây
          một lần, nó sẽ đọc đúng mọi screenshot sau đó.
        </p>
        <GuideTabs />
      </header>

      <div className="mt-10 space-y-14">
        <Section id="cach-dung" eyebrow="Cách dùng" title="Ba bước">
          <Steps
            items={[
              <>
                Bấm <b>Sao chép hướng dẫn</b> bên dưới, dán vào phần Instructions của một Project trong ChatGPT (hoặc
                Claude). Hoặc gửi link <code className="text-sky-300">{AI_GUIDE_PATH}</code> nếu AI đọc được web.
              </>,
              <>
                Với setup 4H, bấm <b>Sao chép cho AI</b> trên thẻ setup ở Overview: số liệu đi dưới dạng chữ, kèm tuổi
                của setup, xu hướng BTC và tình trạng kiểm chứng. Chính xác hơn ảnh.
              </>,
              <>Với các phần khác, gửi screenshot như bình thường.</>,
            ]}
          />
          <Warning>
            <p>
              AI hay đồng ý với người hỏi. Hướng dẫn đã dặn nó nêu cả điểm chống, nhưng quyết định vào lệnh, khối lượng
              và cắt lỗ vẫn là của bạn.
            </p>
          </Warning>
        </Section>

        <Section id="noi-dung" eyebrow="Nội dung" title="Hướng dẫn cho AI">
          <CopyButton
            label="Sao chép hướng dẫn"
            text={GUIDE}
            className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 text-sky-200"
          />
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-xs leading-relaxed text-slate-400">
            {GUIDE}
          </pre>
        </Section>
      </div>
    </div>
  );
}
