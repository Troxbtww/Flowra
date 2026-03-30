export function getCategoryClass(category: string): string {
  const map: Record<string, string> = {
    'Best': 'cat-best',
    'Strong': 'cat-strong',
    'Good': 'cat-good',
    'Unclear': 'cat-unclear',
    'Missed Opportunity': 'cat-missed',
    'Risky': 'cat-risky',
    'Misread Signal': 'cat-misread',
    'Escalation': 'cat-escalation',
    'Blunder': 'cat-blunder'
  }
  return map[category] || 'cat-good'
}

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span className={`category-badge ${getCategoryClass(category)}`}>
      {category}
    </span>
  )
}
