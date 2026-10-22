import { BufferGeometry, Float32BufferAttribute } from "three";
import { squintedEyePoint } from "./fur-detail";

/** Bake once; pressing only updates a GPU morph weight, never rebuilds a mesh. */
export function addEyeSquintMorph(geometry: BufferGeometry, eye: readonly number[], center: readonly number[], radii: readonly number[], origin: readonly number[] = [0, 0, 0]) {
  const positions = geometry.getAttribute("position");
  const values = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const point = squintedEyePoint([
      positions.getX(i) + origin[0], positions.getY(i) + origin[1], positions.getZ(i) + origin[2],
    ], eye, center, radii);
    values.set(point.map((value, axis) => value - origin[axis]), i * 3);
  }
  const target = new Float32BufferAttribute(values, 3);
  if (geometry.hasAttribute("normal")) {
    const temporary = new BufferGeometry();
    temporary.setAttribute("position", target);
    temporary.setIndex(geometry.index);
    temporary.computeVertexNormals();
    geometry.morphAttributes.normal = [temporary.getAttribute("normal")];
    temporary.dispose();
  }
  geometry.morphAttributes.position = [target];
}
