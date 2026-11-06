import one from '../assets/portraits/1.jpg?inline';
import two from '../assets/portraits/2.jpg?inline';
import three from '../assets/portraits/3.jpg?inline';
import four from '../assets/portraits/4.jpg?inline';
import five from '../assets/portraits/5.jpg?inline';
import six from '../assets/portraits/6.jpg?inline';

export interface Portrait { id: string; src: string; own?: boolean }

/** Generated faces, aligned to one another. None of them is a real person. */
export const PORTRAITS: Portrait[] = [one, two, three, four, five, six].map((src, i) => ({ id: String(i + 1), src }));
