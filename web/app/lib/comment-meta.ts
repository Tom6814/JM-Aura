export function getCommentMetaLabels(parentId: string | null): string[] {
  return parentId ? [`回复 ${parentId}`] : [];
}

