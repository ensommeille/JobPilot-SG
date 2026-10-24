export type DescriptionBlock =
  | { kind: 'heading' | 'paragraph'; text: string }
  | { kind: 'list'; items: string[]; ordered?: boolean }

function fallbackBlocks(description: string): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = []
  let paragraph: string[] = []
  let list: string[] = []
  const flushParagraph = () => { if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') }); paragraph = [] }
  const flushList = () => { if (list.length) blocks.push({ kind: 'list', items: list }); list = [] }
  for (const line of description.replace(/\r\n?/g, '\n').split('\n')) {
    const value = line.trim()
    const bullet = value.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/)
    if (!value) { flushParagraph(); flushList() }
    else if (bullet) { flushParagraph(); list.push(bullet[1]) }
    else {
      flushList()
      if (value.endsWith(':') && value.length < 120) { flushParagraph(); blocks.push({ kind: 'heading', text: value }) }
      else paragraph.push(value)
    }
  }
  flushParagraph(); flushList()
  return blocks
}

export default function JobDescription({ description, blocks }: { description?: string; blocks?: DescriptionBlock[] | null }) {
  const display = blocks?.length ? blocks : fallbackBlocks(description || '')
  if (!display.length) return null
  return <section className="job-description" aria-labelledby="job-description-title">
    <h3 id="job-description-title">Job Description</h3>
    {display.map((block, index) => {
      if (block.kind === 'heading') return <h4 key={index}>{block.text}</h4>
      if (block.kind === 'paragraph') return <p key={index}>{block.text}</p>
      if (block.kind === 'list' && Array.isArray(block.items)) return block.ordered
        ? <ol key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ol>
        : <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
      return null
    })}
  </section>
}
