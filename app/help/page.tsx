"use client";
import type React from "react";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { Spinner } from "@/components/ui/skeletons"
import {
  Search,
  MessageCircle,
  Mail,
  Phone,
  Clock,
  CheckCircle,
  HelpCircle,
  Book,
  Video,
  Users,
  Zap,
  
  MessagesSquare,
  ArrowRight,
} from "lucide-react";

interface FAQ {
  id: string
  question: string
  answer: string
  category: string
  helpful: number
}

interface SupportTicket {
  id: string
  subject: string
  status: string
  priority: string
  created_at: string
  updated_at?: string
  last_message?: { message: string; created_at: string } | null
}

export default function HelpPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState("")
  const [supportForm, setSupportForm] = useState({
    subject: "",
    category: "",
    message: "",
    priority: "medium",
  })
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const faqs: FAQ[] = [
    {
      id: "1",
      question: "How do I create my first loop?",
      answer:
        'To create your first loop, click the "Create Loop" button on your dashboard. Choose your content type (text, image, video, or code), add your content, and publish. You can also branch from existing loops to build on others\' ideas.',
      category: "getting-started",
      helpful: 45,
    },
    {
      id: "2",
      question: "What is branching and how does it work?",
      answer:
        "Branching allows you to create a new loop based on an existing one. When you branch, you're creating a connected piece of content that builds upon the original. This creates tree-like structures of related content.",
      category: "features",
      helpful: 38,
    },
    {
      id: "3",
      question: "How do I upgrade to Premium?",
      answer:
        "You can upgrade to Premium by going to Settings > Premium or clicking the Premium badge in the header. Choose your plan and complete the payment process. Premium features will be activated immediately.",
      category: "premium",
      helpful: 29,
    },
    {
      id: "4",
      question: "Can I delete or edit my loops?",
      answer:
        "Yes, you can edit your loops by clicking the edit button on your loop. However, if others have branched from your loop, some restrictions may apply to maintain the integrity of the tree structure.",
      category: "content",
      helpful: 33,
    },
    {
      id: "5",
      question: "How do loopapp.me Circles work?",
      answer:
        "loopapp.me Circles are communities where users can collaborate on specific topics. You can join circles, participate in discussions, attend events, and collaborate on shared projects.",
      category: "community",
      helpful: 27,
    },
    {
      id: "6",
      question: "What are Loop Coins and how do I earn them?",
      answer:
        "Loop Coins are our virtual currency earned through engagement. You earn coins by creating popular content, receiving likes, comments, and having your loops branched. Use coins in the Loop Shop for themes and features.",
      category: "rewards",
      helpful: 41,
    },
  ]

  const filteredFAQs = faqs.filter(
    (faq) =>
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const fetchTickets = useCallback(async () => {
    if (!user) return
    setTicketsLoading(true)
    try {
      const response = await fetch('/api/support/tickets')
      if (response.ok) {
        const data = await response.json()
        setTickets(data.tickets || [])
      }
    } catch (error) {
      console.error('Error fetching tickets:', error)
    } finally {
      setTicketsLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (user) fetchTickets()
  }, [user, fetchTickets])

  // Live refresh while the user is on the page so new support replies appear
  // without a manual reload.
  useEffect(() => {
    if (!user) return
    const interval = setInterval(fetchTickets, 15000)
    return () => clearInterval(interval)
  }, [user, fetchTickets])

  const handleSupportSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const response = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: supportForm.subject,
          category: supportForm.category,
          message: supportForm.message,
          priority: supportForm.priority,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit support ticket')
      }

      // Refresh the live ticket list and reset the form
      setTickets((prev) => [data.ticket, ...prev])
      setSupportForm({
        subject: "",
        category: "",
        message: "",
        priority: "medium",
      })
    } catch (error) {
      toast({
        title: "Couldn't submit your ticket",
        description: error instanceof Error ? error.message : "Check your connection and try again.",
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
      case "in_progress":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
      case "resolved":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
      case "closed":
        return "bg-muted text-muted-foreground"
      default:
        return "bg-muted text-muted-foreground"
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "bg-red-100/20 text-red-500 dark:bg-red-900/30 dark:text-red-400"
      case "medium":
        return "bg-orange-100 text-orange-800"
      case "low":
        return "bg-green-100/20 text-green-600 dark:bg-green-900/30 dark:text-green-400"
      default:
        return "bg-muted text-muted-foreground"
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-4">Help & Support Center</h1>
          <p className="text-muted-foreground text-lg">
            Find answers to your questions or get in touch with our support team
          </p>
        </div>

        {/* Quick Actions */}
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quick actions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card className="text-center hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <Book className="h-8 w-8 mx-auto mb-3 text-primary" />
              <h3 className="font-semibold mb-2">Getting Started</h3>
              <p className="text-sm text-muted-foreground">Learn the basics</p>
            </CardContent>
          </Card>
          <Card className="text-center hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <Video className="h-8 w-8 mx-auto mb-3 text-primary" />
              <h3 className="font-semibold mb-2">Video Tutorials</h3>
              <p className="text-sm text-muted-foreground">Watch and learn</p>
            </CardContent>
          </Card>
          <Card className="text-center hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <Users className="h-8 w-8 mx-auto mb-3 text-primary" />
              <h3 className="font-semibold mb-2">Community</h3>
              <p className="text-sm text-muted-foreground">Connect with users</p>
            </CardContent>
          </Card>
          <Card className="text-center hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <Zap className="h-8 w-8 mx-auto mb-3 text-primary" />
              <h3 className="font-semibold mb-2">Feature Requests</h3>
              <p className="text-sm text-muted-foreground">Suggest improvements</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="faq" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="faq">FAQ</TabsTrigger>
            <TabsTrigger value="contact">Contact Support</TabsTrigger>
            <TabsTrigger value="tickets">My Tickets</TabsTrigger>
            <TabsTrigger value="resources">Resources</TabsTrigger>
          </TabsList>

          {/* FAQ Tab */}
          <TabsContent value="faq" className="mt-6">
            <div className="mb-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search frequently asked questions..."
                  className="pl-10"
                />
              </div>
            </div>

            <Card>
              <CardHeader>
                <h2 className="flex items-center gap-2 text-2xl font-semibold leading-none tracking-tight">
                  <HelpCircle className="h-5 w-5" />
                  Frequently Asked Questions
                </h2>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="w-full">
                  {filteredFAQs.map((faq) => (
                    <AccordionItem key={faq.id} value={faq.id}>
                      <AccordionTrigger className="text-left">
                        <div className="flex items-center gap-3">
                          <span>{faq.question}</span>
                          <Badge variant="outline" className="text-xs">
                            {faq.helpful} helpful
                          </Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="pt-2">
                          <p className="text-muted-foreground mb-4">{faq.answer}</p>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm">
                              👍 Helpful
                            </Button>
                            <Button variant="outline" size="sm">
                              👎 Not helpful
                            </Button>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Contact Support Tab */}
          <TabsContent value="contact" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <h2 className="flex items-center gap-2 text-2xl font-semibold leading-none tracking-tight">
                    <MessageCircle className="h-5 w-5" />
                    Submit a Support Ticket
                  </h2>
                </CardHeader>
                <CardContent>
                  {!user ? (
                    <div className="rounded-xl border border-border bg-muted/30 p-5">
                      <h3 className="font-medium">Sign in to contact support</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Tickets contain account-related details and replies, so you need to sign in before submitting one.
                        You can still read the public Terms of Service and Privacy Policy without an account.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-3">
                        <Button asChild size="sm" className="rounded-full">
                          <Link href="/login?redirect=%2Fhelp">Sign in</Link>
                        </Button>
                        <Link href="/terms" className="inline-flex items-center text-sm text-primary underline underline-offset-4">Terms</Link>
                        <Link href="/privacy" className="inline-flex items-center text-sm text-primary underline underline-offset-4">Privacy</Link>
                      </div>
                    </div>
                  ) : (
                  <form onSubmit={handleSupportSubmit} className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Subject</label>
                      <Input
                        value={supportForm.subject}
                        onChange={(e) => setSupportForm((prev) => ({ ...prev, subject: e.target.value }))}
                        placeholder="Brief description of your issue"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-2 block">Category</label>
                      <select
                        value={supportForm.category}
                        onChange={(e) => setSupportForm((prev) => ({ ...prev, category: e.target.value }))}
                        className="w-full p-2 border rounded-md"
                        required
                      >
                        <option value="">Select a category</option>
                        <option value="technical">Technical Issue</option>
                        <option value="billing">Billing & Payments</option>
                        <option value="account">Account Management</option>
                        <option value="suggestion">Feature Request</option>
                        <option value="content">Content report</option>
                        <option value="privacy">Privacy &amp; data request</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-2 block">Priority</label>
                      <select
                        value={supportForm.priority}
                        onChange={(e) => setSupportForm((prev) => ({ ...prev, priority: e.target.value }))}
                        className="w-full p-2 border rounded-md"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-2 block">Message</label>
                      <Textarea
                        value={supportForm.message}
                        onChange={(e) => setSupportForm((prev) => ({ ...prev, message: e.target.value }))}
                        placeholder="Please provide detailed information about your issue..."
                        rows={5}
                        required
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={submitting}>
                      {submitting ? <Spinner className="mr-2 h-4 w-4" /> : null}
                      Submit Ticket
                    </Button>
                  </form>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <h2 className="text-2xl font-semibold leading-none tracking-tight">Other Ways to Reach Us</h2>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-xl border border-border bg-muted/30 p-4">
                    <p className="font-medium">Account-based support</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Sign in to submit a ticket and keep replies linked to your account. Choose
                      “Privacy &amp; data request” for access, correction, deletion or other privacy requests.
                    </p>
                    {!user && (
                      <Button asChild size="sm" className="mt-3 rounded-full">
                        <Link href="/login?redirect=%2Fhelp">Sign in to contact support</Link>
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-3 p-3 border rounded-lg">
                    <MessagesSquare className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">Live Support Chat</p>
                      <p className="text-sm text-muted-foreground">Real-time replies from our team — ticket or live conversation</p>
                      <Button asChild size="sm" className="mt-2 rounded-full">
                        <Link href="/support/chat">
                          Start Chat <ArrowRight className="ml-1 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* My Tickets Tab */}
          <TabsContent value="tickets" className="mt-6">
            <Card>
              <CardHeader>
                <h2 className="text-2xl font-semibold leading-none tracking-tight">Your Support Tickets</h2>
              </CardHeader>
              <CardContent>
                {!user ? (
                  <div className="py-10 text-center">
                    <CheckCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                    <h3 className="mb-2 text-lg font-semibold">Sign in to see your tickets</h3>
                    <p className="mb-4 text-sm text-muted-foreground">Your support tickets and live replies live under your account.</p>
                    <Button asChild className="rounded-full">
                      <Link href="/login?redirect=/support/chat">Sign in</Link>
                    </Button>
                  </div>
                ) : ticketsLoading && tickets.length === 0 ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground">
                    <Spinner className="mr-2 h-5 w-5" /> Loading tickets…
                  </div>
                ) : tickets.length === 0 ? (
                  <div className="py-10 text-center">
                    <CheckCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                    <h3 className="mb-2 text-lg font-semibold">No support tickets yet</h3>
                    <p className="mx-auto mb-4 max-w-sm text-sm text-muted-foreground">
                      Found a bug or have a question? Open a ticket above or jump straight into the live chat.
                    </p>
                    <Button asChild variant="outline" className="rounded-full">
                      <Link href="/support/chat">Open live chat</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {tickets.map((ticket) => (
                      <div key={ticket.id} className="rounded-xl border p-4 transition-colors hover:border-primary/40">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-semibold">{ticket.subject}</h3>
                          <div className="flex items-center gap-2">
                            <Badge className={getStatusColor(ticket.status)}>{ticket.status.replace(/_/g, " ")}</Badge>
                            <Badge className={getPriorityColor(ticket.priority)}>{ticket.priority}</Badge>
                          </div>
                        </div>
                        {ticket.last_message?.message && (
                          <p className="mb-2 truncate text-sm text-muted-foreground">
                            Last reply: {ticket.last_message.message}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                          <div className="flex items-center gap-4">
                            <span className="text-xs">
                              {ticket.created_at
                                ? `Created ${formatDistanceToNow(new Date(ticket.created_at))} ago`
                                : ""}
                            </span>
                            {ticket.updated_at && ticket.updated_at !== ticket.created_at && (
                              <span className="text-xs">Updated {formatDistanceToNow(new Date(ticket.updated_at))} ago</span>
                            )}
                          </div>
                          <Button asChild size="sm" variant="outline" className="rounded-full text-xs">
                            <Link href={`/support/chat?ticket=${ticket.id}`}>
                              Open conversation <ArrowRight className="ml-1 h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Resources Tab */}
          <TabsContent value="resources" className="mt-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Resources
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">User Guide</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">Complete guide to using all loopapp.me features</p>
                  <Button variant="outline" className="w-full">
                    Read Guide
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Video Tutorials</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">Step-by-step video tutorials for beginners</p>
                  <Button variant="outline" className="w-full">
                    Watch Videos
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">API Documentation</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">Technical documentation for developers</p>
                  <Button variant="outline" className="w-full">
                    View Docs
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Community Forum</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">Connect with other loopapp.me users</p>
                  <Button variant="outline" className="w-full">
                    Join Forum
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Feature Updates</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">Stay updated with latest features</p>
                  <Button variant="outline" className="w-full">
                    View Updates
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Best Practices</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">Tips for creating engaging content</p>
                  <Button variant="outline" className="w-full">
                    Learn More
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      <footer className="mt-12 flex flex-wrap justify-center gap-4 border-t border-border/70 pt-6 text-xs text-muted-foreground">
        <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
        <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
      </footer>
    </div>
  )
}
