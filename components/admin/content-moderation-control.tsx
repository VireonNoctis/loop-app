"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { VideoAvatar } from "@/components/cosmetics/video-avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Flag, CheckCircle, XCircle, Eye, User, Calendar, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface ContentFlag {
  id: string;
  content_type: string;
  content_id: string;
  reporter: {
    display_name: string;
    username: string;
    avatar_url: string;
  };
  flag_type: string;
  description: string;
  status: string;
  created_at: string;
  content_profile?: {
    display_name: string;
    username: string;
    avatar_url: string;
  };
}

export function ContentModerationControl() {
  const { toast } = useToast();
  const { getAuthHeader } = useAuth();
  const [flags, setFlags] = useState<ContentFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('pending');
  const [processing, setProcessing] = useState<string | null>(null);
  const [suspendFlag, setSuspendFlag] = useState<ContentFlag | null>(null);
  const [suspensionReason, setSuspensionReason] = useState("");
  const hasLoadedModerationQueue = useRef(false);

  useEffect(() => {
    void fetchContentFlags()

    // The browser uses the authenticated moderation API rather than a public
    // Supabase table subscription. This keeps report evidence behind the
    // server-side moderator check while still refreshing the queue frequently.
    const refreshInterval = window.setInterval(() => {
      void fetchContentFlags()
    }, 20_000)

    return () => window.clearInterval(refreshInterval)
  }, [filterStatus]);

  const fetchContentFlags = async () => {
    try {
      if (!hasLoadedModerationQueue.current) setLoading(true);
      const response = await fetch(`/api/moderation/flags?status=${filterStatus}`, {
        headers: getAuthHeader(),
      });
      const data = await response.json();
      
      if (data.success) {
        setFlags(data.data || data.flags || []);
      } else {
        setFlags([]);
      }
    } catch (error) {
      console.error('Error fetching content flags:', error);
      toast({
        title: "Error",
        description: "Failed to load content flags",
        variant: "destructive",
      });
    } finally {
      hasLoadedModerationQueue.current = true;
      setLoading(false);
    }
  };

  const deleteReportedContent = async (flag: ContentFlag) => {
    try {
      setProcessing(flag.id)
      const response = await fetch("/api/admin/moderation/delete-content", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
        body: JSON.stringify({ content_type: flag.content_type, content_id: flag.content_id }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to delete content")
      toast({
        title: "Content removed",
        description: "The reported content was deleted and its flags were resolved.",
      })
      fetchContentFlags()
    } catch (error: any) {
      console.error("Error deleting reported content:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to delete content",
        variant: "destructive",
      })
    } finally {
      setProcessing(null)
    }
  }

  const updateFlagStatus = async (flagId: string, status: string, action: string, moderatorNotes?: string): Promise<boolean> => {
    try {
      setProcessing(flagId);
      const response = await fetch(`/api/moderation/flags/${flagId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({ status, action_taken: action, moderator_notes: moderatorNotes }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: "Flag Updated",
          description: "Content flag status updated successfully",
        });
        // Refresh the flags
        fetchContentFlags();
        return true;
      } else {
        throw new Error(data.error || "Failed to update flag");
      }
    } catch (error) {
      console.error('Error updating flag status:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update flag status",
        variant: "destructive",
      });
      return false;
    } finally {
      setProcessing(null);
    }
  };

  const getFlagTypeColor = (flagType: string) => {
    switch (flagType) {
      case 'spam': return 'bg-red-100 text-red-800';
      case 'harassment': return 'bg-orange-100 text-orange-800';
      case 'inappropriate': return 'bg-yellow-100 text-yellow-800';
      case 'copyright': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-blue-100 text-blue-800';
      case 'reviewed': return 'bg-yellow-100 text-yellow-800';
      case 'resolved': return 'bg-green-100 text-green-800';
      case 'dismissed': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Flag className="h-5 w-5 text-red-500" />
              Content Moderation
            </CardTitle>
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="reviewed">Reviewed</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="dismissed">Dismissed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={fetchContentFlags}>
                <Eye className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {flags.length === 0 ? (
            <div className="text-center py-8">
              <Flag className="h-12 w-12 mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium mb-2">No content flags</h3>
              <p className="text-gray-500">There are no content flags with the selected status.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {flags.map((flag) => (
                <div key={flag.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-3">
                      <Avatar>
                        <AvatarImage src={flag.reporter?.avatar_url} />
                        <AvatarFallback>
                          {flag.reporter?.display_name?.charAt(0) || 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold">
                            {flag.reporter?.display_name || 'Unknown User'}
                          </span>
                          <Badge className={getFlagTypeColor(flag.flag_type)}>
                            {flag.flag_type}
                          </Badge>
                          <Badge className={getStatusColor(flag.status)}>
                            {flag.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          Reported content: {flag.content_type} #{flag.content_id}
                        </p>
                        {flag.description && (
                          <p className="text-sm mt-2 bg-gray-50 p-2 rounded">
                            "{flag.description}"
                          </p>
                        )}
                        <div className="flex items-center text-xs text-gray-500 mt-2">
                          <Calendar className="h-3 w-3 mr-1" />
                          <span>{new Date(flag.created_at).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-col space-y-2">
                      {flag.status === "pending" && (
                        <>
                          {["loop", "circle_post", "comment", "reels", "reel", "moment"].includes(flag.content_type) && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => deleteReportedContent(flag)}
                              disabled={processing === flag.id}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Remove content
                            </Button>
                          )}
                          {flag.content_type === "profile" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSuspendFlag(flag)
                                setSuspensionReason("")
                              }}
                              disabled={processing === flag.id}
                            >
                              <User className="h-4 w-4 mr-1" />
                              Suspend account
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateFlagStatus(flag.id, "dismissed", "none")}
                            disabled={processing === flag.id}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Dismiss
                          </Button>
                        </>
                      )}
                      
                      {flag.status === "reviewed" && ["loop", "circle_post", "comment", "reels", "reel", "moment"].includes(flag.content_type) && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteReportedContent(flag)}
                          disabled={processing === flag.id}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Remove content
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(suspendFlag)} onOpenChange={(open) => {
        if (!open) {
          setSuspendFlag(null)
          setSuspensionReason("")
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend reported account</DialogTitle>
            <DialogDescription>
              This suspends the reported profile until the moderation team lifts the suspension. The reason is recorded for the account appeal process.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={suspensionReason}
            onChange={(event) => setSuspensionReason(event.target.value)}
            maxLength={1000}
            rows={4}
            placeholder="Explain the policy reason for this suspension..."
          />
          <p className="text-right text-xs text-muted-foreground">{suspensionReason.length}/1000</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendFlag(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!suspendFlag || !suspensionReason.trim() || processing === suspendFlag.id}
              onClick={async () => {
                if (!suspendFlag) return
                const target = suspendFlag
                const success = await updateFlagStatus(target.id, "resolved", "user_suspended", suspensionReason)
                if (success) {
                  setSuspendFlag(null)
                  setSuspensionReason("")
                }
              }}
            >
              Confirm suspension
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
