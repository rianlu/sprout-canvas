import { useDropzone, type DropzoneRootProps } from 'react-dropzone';

/**
 * File drop area on react-dropzone: drag state that survives child elements, and a document-level guard so a file
 * dropped beside the area is ignored instead of replacing the page. Clicks, keys and paste stay with the caller,
 * so buttons inside the area keep working and paste rules remain in one place.
 * The area stops drag events itself: dialogs stop drops from reaching the page, and react-dropzone discards a drop
 * whose propagation was stopped by an ancestor unless `noDragEventsBubbling` is set.
 */
export function useFileDrop(onFiles: (files: File[]) => void, disabled: boolean) {
  const { getRootProps, isDragActive } = useDropzone({
    disabled,
    noClick: true,
    noKeyboard: true,
    noPaste: true,
    noDragEventsBubbling: true,
    onDrop: (files) => { if (files.length) onFiles(files); },
  });
  // The area is only a container: react-dropzone marks a disabled root aria-disabled, which would also disable
  // every button inside it for assistive tech, so that attribute is dropped.
  const rootProps = (props?: DropzoneRootProps) => {
    const { 'aria-disabled': _disabled, ...rest } = getRootProps(props);
    return rest;
  };
  return { rootProps, dragging: isDragActive && !disabled };
}

/** Reference inputs accept images only; other dropped files are ignored like before. */
export const imagesOnly = (files: File[]) => files.filter((file) => file.type.startsWith('image/'));
