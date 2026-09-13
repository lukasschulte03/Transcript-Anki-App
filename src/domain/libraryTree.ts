import type { LibraryNode, NodeType } from "../core/types";

/** Returns whether a node can be placed below the requested parent. */
export function canMoveLibraryNode(
  nodes: LibraryNode[],
  nodeId: string,
  parentId: string,
) {
  const node = nodes.find((item) => item.id === nodeId);
  const parent = nodes.find((item) => item.id === parentId);
  const allowedParents: Partial<Record<NodeType, NodeType[]>> = {
    course: ["workspace"],
    module: ["course"],
    topic: ["module"],
    lecture: ["module"],
  };
  if (
    !node ||
    !parent ||
    node.id === parent.id ||
    node.parentId === parent.id ||
    !allowedParents[node.type]?.includes(parent.type)
  ) {
    return false;
  }

  const seen = new Set<string>();
  let current: LibraryNode | undefined = parent;
  while (current && !seen.has(current.id)) {
    if (current.id === node.id) return false;
    seen.add(current.id);
    current = current.parentId
      ? nodes.find((item) => item.id === current!.parentId)
      : undefined;
  }
  return true;
}

export function canReorderLibraryNode(
  nodes: LibraryNode[],
  nodeId: string,
  targetId: string,
) {
  const node = nodes.find((item) => item.id === nodeId);
  const target = nodes.find((item) => item.id === targetId);
  const isLeaf = (type: NodeType) => type === "topic" || type === "lecture";
  return Boolean(
    node &&
      target &&
      node.id !== target.id &&
      node.parentId === target.parentId &&
      (node.type === target.type || (isLeaf(node.type) && isLeaf(target.type))),
  );
}

function orderedSiblings(nodes: LibraryNode[], parentId: string | null) {
  return nodes
    .filter((node) => node.parentId === parentId)
    .sort((left, right) => (left.sortIndex ?? 0) - (right.sortIndex ?? 0));
}

function normalizeSiblingOrder(
  nodes: LibraryNode[],
  parentIds: Array<string | null>,
) {
  const positions = new Map<string, number>();
  [...new Set(parentIds)].forEach((parentId) => {
    orderedSiblings(nodes, parentId).forEach((node, index) =>
      positions.set(node.id, index),
    );
  });
  return nodes.map((node) =>
    positions.has(node.id)
      ? { ...node, sortIndex: positions.get(node.id) }
      : node,
  );
}

export function moveLibraryNode(
  nodes: LibraryNode[],
  nodeId: string,
  parentId: string,
) {
  if (!canMoveLibraryNode(nodes, nodeId, parentId)) return nodes;
  const node = nodes.find((item) => item.id === nodeId)!;
  const appendIndex = orderedSiblings(nodes, parentId).length;
  const moved = nodes.map((item) =>
    item.id === nodeId ? { ...item, parentId, sortIndex: appendIndex } : item,
  );
  return normalizeSiblingOrder(moved, [node.parentId, parentId]);
}

export function reorderLibraryNode(
  nodes: LibraryNode[],
  nodeId: string,
  targetId: string,
) {
  if (!canReorderLibraryNode(nodes, nodeId, targetId)) return nodes;
  const node = nodes.find((item) => item.id === nodeId)!;
  const siblings = orderedSiblings(nodes, node.parentId).filter(
    (item) => item.id !== nodeId,
  );
  siblings.splice(
    siblings.findIndex((item) => item.id === targetId),
    0,
    node,
  );
  const positions = new Map(siblings.map((item, index) => [item.id, index]));
  return nodes.map((item) =>
    positions.has(item.id)
      ? { ...item, sortIndex: positions.get(item.id) }
      : item,
  );
}
