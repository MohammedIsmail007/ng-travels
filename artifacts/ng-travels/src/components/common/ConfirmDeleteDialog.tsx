import React from "react";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ButtonLoader } from "@/components/loading";

interface ConfirmDeleteDialogProps {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

/**
 * Shared "are you sure?" step for deleting customers, vehicles and drivers.
 * The confirm button is a plain Button (not AlertDialogAction) so the dialog
 * stays open with a spinner until the request resolves, and stays open on
 * failure instead of closing as if the delete had worked.
 */
export const ConfirmDeleteDialog: React.FC<ConfirmDeleteDialogProps> = ({
  isOpen,
  title,
  description,
  loading = false,
  onConfirm,
  onClose,
}) => (
  <AlertDialog open={isOpen} onOpenChange={(open) => !open && !loading && onClose()}>
    <AlertDialogContent className="bg-background border-border text-foreground">
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
          <Trash2 className="w-4 h-4" /> {title}
        </AlertDialogTitle>
        <AlertDialogDescription className="text-xs text-muted-foreground">
          {description}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={loading} className="text-xs">
          Cancel
        </AlertDialogCancel>
        <Button
          onClick={onConfirm}
          disabled={loading}
          className="bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs"
        >
          {loading ? <ButtonLoader label="Deleting..." /> : "Delete"}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
